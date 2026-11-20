/**
 * Arranca la app con la configuración de las variables de entorno:
 *   NODE_ENV=production → `next start` (requiere `npm run build` antes)
 *   otro valor o vacío  → `next dev`
 *   PORT  → puerto (por defecto 3001)
 *   HOST  → dirección donde escucha (por defecto 127.0.0.1 en producción, localhost en desarrollo)
 *
 * Uso: `npm start` (según NODE_ENV) o `npm run dev` (fuerza desarrollo).
 * Las variables se leen del entorno y del archivo .env (ver package.json).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const forceDev = process.argv[2] === "dev";
const mode = !forceDev && process.env.NODE_ENV === "production" ? "start" : "dev";

const port = process.env.PORT?.trim() || "3001";
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(`PORT inválido: "${port}". Debe ser un número entre 1 y 65535.`);
  process.exit(1);
}
const host = process.env.HOST?.trim() || (mode === "start" ? "127.0.0.1" : "localhost");

console.log(`Iniciando en modo ${mode === "start" ? "producción" : "desarrollo"} en http://${host}:${port}`);

const child = spawn(process.execPath, [nextBin, mode, "-p", port, "-H", host], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: mode === "start" ? "production" : "development" },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
