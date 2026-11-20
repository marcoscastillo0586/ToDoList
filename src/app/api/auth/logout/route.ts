import { NextRequest, NextResponse } from "next/server";
import { deleteSession, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";

/** Cierra la sesión: la borra de la base y elimina la cookie. */
export async function POST(request: NextRequest) {
  const cookieName = sessionCookieName();
  try {
    await deleteSession(request.cookies.get(cookieName)?.value);
  } catch (err) {
    console.error("Error al cerrar sesión:", err);
  }
  const res = NextResponse.json({ ok: true });
  // Mismos atributos que al crearla (las cookies __Host- exigen Secure también al borrarlas)
  res.cookies.set(cookieName, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
