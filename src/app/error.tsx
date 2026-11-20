"use client";

import { useEffect } from "react";

/** Error inesperado en una página: mensaje genérico, sin detalles técnicos. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Solo en la consola del navegador; en producción Next.js ya oculta el detalle.
    console.error(error.digest ?? "Error inesperado");
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm text-center bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h1 className="text-lg font-bold text-slate-900">Ocurrió un error</h1>
        <p className="text-sm text-slate-500 mt-2">
          No se pudo completar la operación. Intentá de nuevo.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
