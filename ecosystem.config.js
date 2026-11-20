// Configuración de PM2. El modo, el puerto y la dirección se leen del archivo .env
// (NODE_ENV, PORT y HOST). Antes de iniciar en producción: `npm run build`.
module.exports = {
  apps: [
    {
      name: "ToDoList",
      cwd: __dirname,
      script: "scripts/start.mjs",
      node_args: ["--env-file-if-exists=.env"],
    },
  ],
};
