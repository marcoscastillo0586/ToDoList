import bcrypt from "bcryptjs";

/** Costo de bcrypt: 12 ≈ 250 ms por verificación (lento a propósito contra la fuerza bruta). */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

// Hash de relleno: cuando el correo no existe se verifica igual contra este hash,
// para que el tiempo de respuesta no revele si el usuario existe.
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(
  password: string,
  hash: string | null
): Promise<boolean> {
  if (hash === null) {
    dummyHash ??= bcrypt.hash("contrasena-de-relleno-sin-uso", BCRYPT_COST);
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
