import type { Metadata } from "next";
import "./globals.css";

// Las páginas se generan en cada pedido: así Next.js aplica a sus scripts el
// nonce de la Content-Security-Policy que agrega el middleware.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gestor de Listas y Actividades — To-Do List",
  description:
    "Aplicación web de gestión de listas de tareas y control de tiempos estimados vs. reales",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}

