# Gestor de Listas y Actividades

Aplicación web personal para organizar tarjetas (listas) de actividades, verlas en un
calendario mensual y comparar el tiempo estimado con el tiempo real de cada tarea.

Cada usuario tiene su propio calendario: solo ve y modifica sus tarjetas y actividades.

## Tecnologías

- **Next.js 15** (App Router) con **TypeScript** y **React 19**
- **Prisma 6** como ORM sobre **MySQL**
- **Tailwind CSS**
- **bcryptjs** para el hash de contraseñas

## Funcionalidades

- **Tablero**: tarjetas con actividades jerárquicas (actividades madre con tareas hijas),
  vista de lista y de árbol, reordenamiento.
- **Calendario**: vista mensual; las actividades pendientes se arrastran de un día a otro
  manteniendo su horario y duración.
- **Varios días**: una tarea se puede replicar en varios días; las copias quedan en la
  misma tarjeta y con la misma madre que la original.
- **Realizadas**: actividades finalizadas del día, la semana o el mes, con la diferencia
  entre el tiempo estimado y el real.
- **Login** con correo y contraseña; no hay registro público (ver
  [Usuarios](#usuarios)).

## Requisitos

- **Node.js 22.9 o superior** (los scripts usan `--env-file-if-exists`).
- **MySQL** (por ejemplo el de XAMPP en desarrollo).

## Puesta en marcha

### 1. Variables de entorno

```bash
cp .env.example .env
```

Completá `.env`. Cada variable está explicada en [.env.example](.env.example). Resumen:

| Variable | Para qué | Desarrollo | Producción |
|---|---|---|---|
| `DATABASE_URL` | Conexión a MySQL | `mysql://usuario:clave@127.0.0.1:3306/todolist` | igual, con un usuario de MySQL propio de la app |
| `NODE_ENV` | Modo de ejecución | `development` | `production` |
| `PORT` | Puerto donde escucha | `3001` | el que corresponda |
| `HOST` | Dirección donde escucha | `localhost` | `127.0.0.1` (detrás del proxy inverso) |
| `APP_ORIGIN` | Dirección pública (protección CSRF) | `http://localhost:3001` | `https://tudominio` (obligatoria) |
| `TRUST_PROXY` | Confiar en `X-Forwarded-*` del proxy | `false` | `true` |
| `COOKIE_SECURE` | Cookies solo por HTTPS | `false` | `true` |
| `SESSION_SECRET` | Firma del token CSRF | opcional | obligatoria, 32+ caracteres |
| `SESSION_IDLE_MINUTES` | Inactividad hasta que vence la sesión | `25` | `25` |
| `SESSION_TTL_HOURS` | Vida máxima de la sesión (se renueva con el uso) | `4` | `4` |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | Límite de intentos de login fallidos | `5` / `15` | `5` / `15` |

Generar un `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

En producción la app se niega a atender pedidos si falta `APP_ORIGIN` o si
`SESSION_SECRET` es demasiado corto (el detalle queda en el registro del servidor).

### 2. Dependencias

```bash
npm ci
npx prisma generate
```

`npx prisma generate` es necesario porque las versiones recientes de npm no ejecutan
automáticamente los scripts de instalación de Prisma. No uses `--omit=dev`: la
herramienta `prisma` (para las migraciones) está en las dependencias de desarrollo.

### 3. Base de datos

Con MySQL en marcha y la base creada:

```bash
npx prisma migrate deploy
```

Aplica todas las migraciones de [prisma/migrations](prisma/migrations).

> Si la base ya tiene tarjetas y actividades de una versión anterior (sin usuarios), creá
> un usuario **antes** de aplicar la migración `add_user_ownership`: los datos existentes
> se asignan al primer usuario. Sin usuario, esa migración falla sin modificar datos.

### 4. Usuarios

No hay registro público: los usuarios se cargan directamente en la base.

```bash
npm run hash-password
```

Pide el correo y la contraseña (mínimo 8 caracteres; no se muestra al escribirla) e
imprime el SQL listo para ejecutar en MySQL: el `INSERT` para crear el usuario, el
`UPDATE` para cambiarle la contraseña y el `DELETE` para cerrar sus sesiones abiertas.
La contraseña se guarda solo como hash bcrypt.

Para desactivar un usuario sin borrarlo: `UPDATE users SET is_active = 0 WHERE email = '...';`

### 5. Ejecutar

**Desarrollo** (sin HTTPS, recarga automática):

```bash
npm run dev
```

**Producción**:

```bash
npm run build
npm start
```

`npm start` arranca en el modo que indique `NODE_ENV`, en el `PORT` y `HOST`
configurados. `npm run dev` fuerza siempre el modo desarrollo.

**Con PM2** (lee las mismas variables del `.env`):

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

Después de cada cambio de código: `npm run build` y `pm2 restart ToDoList`.

## Producción detrás de un proxy inverso

La app está preparada para funcionar con HTTPS detrás de un servidor web que actúa como
proxy inverso:

- `HOST=127.0.0.1`: la app solo acepta conexiones del propio servidor.
- `TRUST_PROXY=true`: toma la IP real del cliente del último valor de `X-Forwarded-For`
  (para el límite de intentos de login). No lo actives si la app está expuesta sin proxy.
- `COOKIE_SECURE=true`: las cookies llevan `Secure` y el prefijo `__Host-`.
- `APP_ORIGIN=https://tudominio`: los pedidos que modifican datos se rechazan si no vienen
  de esa dirección.

## Seguridad

- Contraseñas con **bcrypt** (costo 12). Mensaje de error genérico en el login y mismo
  tiempo de respuesta exista o no el correo.
- **Sesiones** guardadas en la base (solo el hash SHA-256 del token). Cookie `HttpOnly`,
  `SameSite=Lax` y `Secure` en producción. Vencen tras `SESSION_IDLE_MINUTES` sin uso y se
  renuevan solas mientras se usa la app.
- **Todas las páginas y rutas de la API** exigen sesión, salvo `/login`
  ([src/middleware.ts](src/middleware.ts)). Cada ruta filtra los datos por el usuario.
- **CSRF**: token firmado en el formulario de login y verificación del encabezado
  `Origin` en todos los pedidos que modifican datos.
- **Fuerza bruta**: bloqueo tras `LOGIN_MAX_ATTEMPTS` fallos en `LOGIN_WINDOW_MINUTES`,
  por correo y por IP.
- **Encabezados**: Content-Security-Policy con nonce por pedido, HSTS (producción),
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Consultas a la base siempre a través de Prisma (parametrizadas).
- En producción no se muestran errores técnicos al usuario.

## Estructura

```
prisma/
  schema.prisma          Modelos: usuarios, sesiones, intentos de login, tarjetas, actividades
  migrations/            Migraciones SQL
scripts/
  start.mjs              Arranque según NODE_ENV, PORT y HOST
  hash-password.mjs      Genera el hash y el SQL para crear usuarios
src/
  middleware.ts          Sesión obligatoria, CSRF, CSP
  app/
    page.tsx             Aplicación (tablero, calendario, realizadas)
    login/page.tsx       Página de login
    api/auth/            Login, logout y token CSRF
    api/lists/           Tarjetas y sus actividades
    api/activities/      Edición, varios días y realizadas
  lib/
    auth/                Sesiones, contraseñas, CSRF, límite de intentos, validación
    env.ts               Lectura y validación de las variables de entorno
    limits.ts            Largos máximos (tarjeta 25, actividad 100 caracteres)
ecosystem.config.js      Configuración de PM2
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Desarrollo |
| `npm run build` | Compila para producción |
| `npm start` | Arranca según `NODE_ENV` |
| `npm test` | Tests del cálculo del árbol de actividades |
| `npm run hash-password` | Genera el SQL para crear o actualizar un usuario |

## Notas

- **Dependencias**: [package.json](package.json) fuerza con `overrides` versiones
  corregidas de `postcss`, `effect` y `deepmerge-ts` (dependencias indirectas de Next.js y
  Prisma con vulnerabilidades conocidas). Al actualizar Next.js o Prisma, revisá si siguen
  haciendo falta (`npm audit`).
- **Windows**: si `npx prisma generate` falla con `EPERM ... query_engine-windows.dll.node`,
  es porque la app está corriendo y tiene el archivo abierto. Detenela, generá y volvé a
  iniciarla.
