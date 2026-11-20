"use client";

import React, { useCallback, useEffect, useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN_LENGTH = 8;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCsrf = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/csrf", { cache: "no-store" });
      const data = await res.json();
      setCsrfToken(typeof data?.csrfToken === "string" ? data.csrfToken : null);
    } catch {
      setError("No se pudo conectar con el servidor. Recargá la página.");
    }
  }, []);

  useEffect(() => {
    loadCsrf();
  }, [loadCsrf]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError("Ingresá un correo electrónico válido.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (!csrfToken) {
      setError("El formulario no está listo. Recargá la página.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password, csrfToken }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "No se pudo iniciar sesión.");
      setPassword("");
      // Cada intento usa un token CSRF nuevo
      if (res.status === 403) await loadCsrf();
    } catch {
      setError("Error de red. Intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Iniciar sesión</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          Gestor de Listas y Actividades
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm font-medium text-rose-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !csrfToken}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
          >
            {submitting ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}
