import { getConfig } from "@/lib/env";

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * IP del cliente. Solo se lee X-Forwarded-For si TRUST_PROXY=true: sin proxy,
 * cualquiera podría inventarse ese encabezado. Se toma el último valor, que es
 * el que agregó nuestro proxy inverso (los anteriores los puede enviar el cliente).
 * Devuelve null si no se puede determinar.
 */
export function getClientIp(headers: Headers): string | null {
  if (!getConfig().trustProxy) return null;
  const forwarded = headers.get("x-forwarded-for");
  const candidate =
    forwarded?.split(",").map((s) => s.trim()).filter(Boolean).pop() ??
    headers.get("x-real-ip")?.trim();
  return candidate && IP_RE.test(candidate) ? candidate : null;
}
