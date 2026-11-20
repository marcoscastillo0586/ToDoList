import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/env";

/**
 * Token CSRF del formulario de login ("double submit" firmado):
 * la cookie guarda `token.firma` y el formulario envía `token`.
 * Un sitio ajeno no puede leer la cookie ni falsificar la firma.
 */

export const CSRF_MAX_AGE_SECONDS = 60 * 60;

export function csrfCookieName(): string {
  return getConfig().cookieSecure ? "__Host-todolist_csrf" : "todolist_csrf";
}

function sign(token: string): string {
  return createHmac("sha256", getConfig().sessionSecret).update(token).digest("base64url");
}

export function createCsrfToken(): { token: string; cookieValue: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, cookieValue: `${token}.${sign(token)}` };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyCsrfToken(submitted: unknown, cookieValue: string | undefined): boolean {
  if (typeof submitted !== "string" || !submitted || !cookieValue) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return false;
  const token = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  return safeEqual(signature, sign(token)) && safeEqual(submitted, token);
}

export function csrfCookieOptions() {
  return {
    httpOnly: true,
    secure: getConfig().cookieSecure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: CSRF_MAX_AGE_SECONDS,
  };
}
