import { NextResponse } from "next/server";
import { createCsrfToken, csrfCookieName, csrfCookieOptions } from "@/lib/auth/csrf";

/** Entrega un token CSRF nuevo para el formulario de login. */
export async function GET() {
  const { token, cookieValue } = createCsrfToken();
  const res = NextResponse.json({ csrfToken: token });
  res.cookies.set(csrfCookieName(), cookieValue, csrfCookieOptions());
  return res;
}
