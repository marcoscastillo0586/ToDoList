/** Validación de las credenciales del formulario de login. */

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt solo usa los primeros 72 bytes: más largo se rechaza en lugar de truncarse en silencio. */
export const PASSWORD_MAX_BYTES = 72;
export const EMAIL_MAX_LENGTH = 254;

// Formato práctico de correo: algo@dominio.tld, sin espacios.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(email);
}

export function passwordError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `La contraseña no puede superar los ${PASSWORD_MAX_BYTES} caracteres.`;
  }
  return null;
}
