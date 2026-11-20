"use client";

/** Error en el diseño raíz: reemplaza toda la página con un mensaje genérico. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>Ocurrió un error</h1>
        <p>No se pudo cargar la aplicación. Intentá de nuevo.</p>
        <button type="button" onClick={reset}>
          Reintentar
        </button>
      </body>
    </html>
  );
}
