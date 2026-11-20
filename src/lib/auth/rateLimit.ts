import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/env";

/**
 * Límite de intentos de login fallidos, guardado en la base (sobrevive a reinicios).
 * Se bloquea si en la ventana de tiempo hay LOGIN_MAX_ATTEMPTS fallos:
 * - para el mismo correo (contando solo desde su último login correcto), o
 * - para la misma IP (solo si se conoce la IP real, ver TRUST_PROXY).
 * El bloqueo termina solo cuando los fallos salen de la ventana.
 */
export async function isLoginBlocked(email: string, ip: string | null): Promise<boolean> {
  const { loginMaxAttempts, loginWindowMs } = getConfig();
  const windowStart = new Date(Date.now() - loginWindowMs);

  const lastSuccess = await prisma.loginAttempt.findFirst({
    where: { email, success: true, createdAt: { gt: windowStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const emailFails = await prisma.loginAttempt.count({
    where: {
      email,
      success: false,
      createdAt: { gt: lastSuccess?.createdAt ?? windowStart },
    },
  });
  if (emailFails >= loginMaxAttempts) return true;

  if (ip) {
    const ipFails = await prisma.loginAttempt.count({
      where: { ip, success: false, createdAt: { gt: windowStart } },
    });
    if (ipFails >= loginMaxAttempts) return true;
  }
  return false;
}

export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  success: boolean
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email, ip: ip ?? "desconocida", success },
  });
}

/** Limpieza: borra intentos de más de un día (se llama tras un login correcto). */
export async function pruneLoginAttempts(): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
}
