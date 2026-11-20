import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import {
  sessionCookieName,
  sessionCookieOptions,
  validateSession,
} from "@/lib/auth/session";

/**
 * Se ejecuta antes de cada página y cada ruta de la API:
 * 1. Protección CSRF: los pedidos que modifican datos deben venir de la propia app (Origin).
 * 2. Sesión obligatoria salvo en el login. Sin sesión: páginas → /login, API → 401.
 * 3. Renueva la sesión en cada uso (no se cierra mientras se usa la app).
 * 4. Content-Security-Policy con nonce por pedido.
 */

// Rutas accesibles sin sesión
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/csrf"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function expectedOrigin(req: NextRequest): string {
  const { appOrigin, trustProxy } = getConfig();
  if (appOrigin) return appOrigin;
  // Solo en desarrollo (en producción APP_ORIGIN es obligatorio)
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const proto = trustProxy
    ? req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? "http"
    : req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function isSameOriginRequest(req: NextRequest): boolean {
  // Los navegadores modernos marcan los pedidos de otros sitios
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = req.headers.get("origin");
  return origin !== null && origin === expectedOrigin(req);
}

function buildCsp(nonce: string, isProduction: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function middleware(req: NextRequest) {
  const config = getConfig();
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // 1. CSRF
  if (!SAFE_METHODS.has(req.method) && !isSameOriginRequest(req)) {
    return jsonError("Solicitud no permitida.", 403);
  }

  // 2. Sesión
  const cookieName = sessionCookieName();
  const token = req.cookies.get(cookieName)?.value;
  const user = await validateSession(token, { touch: true });
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!user && !isPublic) {
    const res = isApi
      ? jsonError("Tu sesión venció. Volvé a iniciar sesión.", 401)
      : NextResponse.redirect(new URL("/login", config.appOrigin ?? req.url));
    if (token) res.cookies.set(cookieName, "", { ...sessionCookieOptions(), maxAge: 0 });
    return res;
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", config.appOrigin ?? req.url));
  }

  // 4. CSP con nonce (Next.js lo toma del encabezado del pedido y lo aplica a sus scripts)
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = buildCsp(nonce, config.isProduction);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);

  // 3. Renovar la cookie de sesión (se reinicia el contador de inactividad)
  if (user && token) {
    res.cookies.set(cookieName, token, sessionCookieOptions());
  }
  return res;
}

export const config = {
  // Runtime de Node: necesario para consultar la sesión en la base con Prisma.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
