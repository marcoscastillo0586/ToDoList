/**
 * Genera el hash bcrypt de una contraseña y el SQL para crear o actualizar un usuario.
 * No escribe en la base: imprime el SQL para que lo ejecutes vos.
 *
 * Uso:  npm run hash-password
 * (pide el correo y la contraseña; la contraseña no se muestra al escribirla)
 */
import bcrypt from "bcryptjs";
import readline from "node:readline";

const BCRYPT_COST = 12; // igual que en src/lib/auth/password.ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Oculta lo que se escribe (muestra solo la pregunta)
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const email = (await ask("Correo del usuario: ")).trim().toLowerCase();
if (!EMAIL_RE.test(email) || email.length > 254) {
  console.error("El correo no tiene un formato válido.");
  process.exit(1);
}

const password = await ask("Contraseña (mínimo 8 caracteres): ", { hidden: true });
if (password.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}
if (Buffer.byteLength(password, "utf8") > 72) {
  console.error("La contraseña no puede superar los 72 caracteres.");
  process.exit(1);
}
const repeat = await ask("Repetí la contraseña: ", { hidden: true });
if (repeat !== password) {
  console.error("Las contraseñas no coinciden.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, BCRYPT_COST);
const sqlEmail = email.replace(/'/g, "''");

console.log(`
Hash generado:
${hash}

-- Crear un usuario nuevo:
INSERT INTO users (email, password_hash, is_active, created_at, updated_at)
VALUES ('${sqlEmail}', '${hash}', 1, NOW(3), NOW(3));

-- O cambiar la contraseña de un usuario existente:
UPDATE users SET password_hash = '${hash}', updated_at = NOW(3) WHERE email = '${sqlEmail}';

-- Para cerrar todas sus sesiones abiertas después de cambiar la contraseña:
DELETE s FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = '${sqlEmail}';
`);
