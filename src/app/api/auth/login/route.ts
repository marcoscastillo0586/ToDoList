import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { csrfCookieName, csrfCookieOptions, verifyCsrfToken } from "@/lib/auth/csrf";
import { getClientIp } from "@/lib/auth/clientIp";
import { verifyPassword } from "@/lib/auth/password";
import { isLoginBlocked, pruneLoginAttempts, recordLoginAttempt } from "@/lib/auth/rateLimit";
import {
  createSession,
  deleteSession,
  pruneExpiredSessions,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { isValidEmail, normalizeEmail, passwordError } from "@/lib/auth/validation";

// Mensaje único para cualquier fallo de credenciales: no revela si el correo existe.
const INVALID_CREDENTIALS = "Correo o contraseña incorrectos.";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return error("Solicitud inválida.", 400);
    }

    // CSRF del formulario
    const csrfCookie = request.cookies.get(csrfCookieName())?.value;
    if (!verifyCsrfToken(body?.csrfToken, csrfCookie)) {
      return error("El formulario venció. Recargá la página e intentá de nuevo.", 403);
    }

    // Validación de formato
    const email = normalizeEmail(body?.email);
    if (!isValidEmail(email)) {
      return error("Ingresá un correo electrónico válido.", 400);
    }
    const pwdError = passwordError(body?.password);
    if (pwdError) {
      return error(pwdError, 400);
    }
    const password = body.password as string;

    // Fuerza bruta
    const ip = getClientIp(request.headers);
    if (await isLoginBlocked(email, ip)) {
      return error("Demasiados intentos fallidos. Esperá unos minutos e intentá de nuevo.", 429);
    }

    // Verificación (se calcula el hash aunque el usuario no exista: mismo tiempo de respuesta)
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isActive: true },
    });
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !user.isActive || !passwordOk) {
      await recordLoginAttempt(email, ip, false);
      return error(INVALID_CREDENTIALS, 401);
    }

    await recordLoginAttempt(email, ip, true);

    // Sesión nueva (si había una anterior en este navegador, se descarta)
    const cookieName = sessionCookieName();
    await deleteSession(request.cookies.get(cookieName)?.value);
    const token = await createSession(user.id, ip, request.headers.get("user-agent"));

    await Promise.all([pruneExpiredSessions(), pruneLoginAttempts()]);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(cookieName, token, sessionCookieOptions());
    res.cookies.set(csrfCookieName(), "", { ...csrfCookieOptions(), maxAge: 0 });
    return res;
  } catch (err) {
    console.error("Error en el login:", err);
    return error("No se pudo iniciar sesión. Intentá de nuevo más tarde.", 500);
  }
}
