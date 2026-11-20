/**
 * Configuración del servidor leída de variables de entorno (ver .env.example).
 *
 * Se lee recién en el primer uso, no al importar el módulo: así `next build`
 * funciona sin las variables de producción. En producción, si falta una
 * variable obligatoria o es inválida, la app falla al atender el primer pedido
 * en lugar de arrancar con una configuración insegura.
 */

export interface ServerConfig {
  isProduction: boolean;
  /** Origen público de la app (ej. https://midominio.com). null = se deduce del pedido (solo desarrollo). */
  appOrigin: string | null;
  /** Confiar en X-Forwarded-For / X-Forwarded-Proto del proxy inverso. */
  trustProxy: boolean;
  /** Cookies con atributo Secure (solo viajan por HTTPS). */
  cookieSecure: boolean;
  /** Clave para firmar el token CSRF. */
  sessionSecret: string;
  /** Vida máxima de la sesión; se renueva con cada uso. */
  sessionTtlMs: number;
  /** Tiempo sin actividad tras el cual la sesión vence. */
  sessionIdleMs: number;
  loginMaxAttempts: number;
  loginWindowMs: number;
}

const DEV_FALLBACK_SECRET = "solo-para-desarrollo-local-no-usar-en-produccion";

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["true", "1", "yes", "si"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  throw new Error(`La variable de entorno ${name} debe ser true o false.`);
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`La variable de entorno ${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return n;
}

function readOrigin(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`La variable de entorno ${name} no es una URL válida.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`La variable de entorno ${name} debe empezar con https:// o http://.`);
  }
  return url.origin;
}

function loadConfig(): ServerConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const appOrigin = readOrigin("APP_ORIGIN");
  const cookieSecure = readBool("COOKIE_SECURE", isProduction);
  const secret = process.env.SESSION_SECRET?.trim() ?? "";

  if (isProduction) {
    if (!appOrigin) {
      throw new Error("Falta APP_ORIGIN (la dirección pública de la app, ej. https://midominio.com).");
    }
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET debe tener al menos 32 caracteres en producción.");
    }
  }

  return {
    isProduction,
    appOrigin,
    trustProxy: readBool("TRUST_PROXY", false),
    cookieSecure,
    sessionSecret: secret.length >= 32 ? secret : DEV_FALLBACK_SECRET,
    sessionTtlMs: readInt("SESSION_TTL_HOURS", 4, 1, 720) * 60 * 60 * 1000,
    sessionIdleMs: readInt("SESSION_IDLE_MINUTES", 25, 1, 1440) * 60 * 1000,
    loginMaxAttempts: readInt("LOGIN_MAX_ATTEMPTS", 5, 1, 100),
    loginWindowMs: readInt("LOGIN_WINDOW_MINUTES", 15, 1, 1440) * 60 * 1000,
  };
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (!cached) cached = loadConfig();
  return cached;
}
