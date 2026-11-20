import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName, validateSession, type SessionUser } from "@/lib/auth/session";

/**
 * Usuario de la sesión actual, para las rutas de la API.
 * El middleware ya bloquea los pedidos sin sesión; esto se vuelve a validar
 * en cada ruta (defensa en profundidad) y da el id del usuario para filtrar los datos.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return validateSession(store.get(sessionCookieName())?.value, { touch: false });
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Tu sesión venció. Volvé a iniciar sesión." },
    { status: 401 }
  );
}
