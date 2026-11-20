import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/env";

/**
 * Sesiones guardadas en la base. El navegador recibe un token aleatorio en una
 * cookie HttpOnly; en la base solo queda su hash SHA-256.
 *
 * Vencimiento:
 * - Sin actividad durante SESSION_IDLE_MINUTES → vence.
 * - Cada pedido renueva la sesión en silencio (última actividad y vida máxima).
 */

export interface SessionUser {
  sessionId: number;
  userId: number;
  email: string;
}

/** No se escribe en la base en cada pedido: solo si pasó este tiempo desde la última renovación. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export function sessionCookieName(): string {
  // El prefijo __Host- obliga a Secure, Path=/ y sin Domain (solo para este dominio exacto).
  return getConfig().cookieSecure ? "__Host-todolist_session" : "todolist_session";
}

export function sessionCookieOptions() {
  const { cookieSecure, sessionIdleMs } = getConfig();
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    // La cookie vence con la inactividad; cada pedido la vuelve a enviar renovada.
    maxAge: Math.floor(sessionIdleMs / 1000),
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: number,
  ip: string | null,
  userAgent: string | null
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + getConfig().sessionTtlMs),
      lastSeenAt: new Date(now),
      ip,
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
    },
  });
  return token;
}

/**
 * Valida el token. Con `touch` renueva la sesión (lo hace el middleware en cada pedido).
 * Devuelve null si no existe, venció o el usuario está desactivado.
 */
export async function validateSession(
  token: string | undefined,
  { touch }: { touch: boolean }
): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, isActive: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  const { sessionIdleMs, sessionTtlMs } = getConfig();
  const expired =
    session.expiresAt.getTime() <= now ||
    now - session.lastSeenAt.getTime() > sessionIdleMs ||
    !session.user.isActive;
  if (expired) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (touch && now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + sessionTtlMs) },
    });
  }

  return { sessionId: session.id, userId: session.user.id, email: session.user.email };
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Limpieza: borra sesiones vencidas (se llama tras un login correcto). */
export async function pruneExpiredSessions(): Promise<void> {
  const { sessionIdleMs } = getConfig();
  const now = Date.now();
  await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: new Date(now) } },
        { lastSeenAt: { lt: new Date(now - sessionIdleMs) } },
      ],
    },
  });
}
