const isProduction = process.env.NODE_ENV === "production";

// Encabezados de seguridad fijos. La Content-Security-Policy la agrega el
// middleware porque lleva un nonce distinto en cada pedido.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS: el navegador solo lo tiene en cuenta cuando llega por HTTPS.
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No anunciar "X-Powered-By: Next.js"
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Las respuestas de la API tienen datos personales: que nadie las guarde en caché
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
