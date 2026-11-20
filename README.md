# Gestor de Listas y Actividades (To-Do List)

Aplicación web construida con **Next.js (App Router)**, **TypeScript**, **Prisma ORM**, **MySQL** y **Tailwind CSS**.

## Requisitos previos

- **Node.js** 18 o superior y **npm**.
- **MySQL** local en ejecución (por ejemplo, mediante XAMPP en el puerto `3306`).

## Configuración de variables de entorno

El proyecto utiliza el archivo `.env` ubicado en la raíz del repositorio para conectarse a MySQL.  
Si necesitás configurar el entorno desde cero en otra máquina, podés copiar el archivo de ejemplo:

```bash
cp .env.example .env
```

Y completar la variable `DATABASE_URL` con tus credenciales locales de MySQL, por ejemplo:

```env
DATABASE_URL="mysql://root@127.0.0.1:3306/todolist"

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=todolist
```

## Pasos para instalar y ejecutar el proyecto

### 1. Instalar las dependencias

Desde la raíz del proyecto (`c:\xampp\htdocs\toDoList`), ejecutá:

```bash
npm install
```

### 2. Ejecutar las migraciones de Prisma contra MySQL local

Asegurate de que el servicio de MySQL esté corriendo y ejecutá:

```bash
npx prisma migrate dev
```

*(O bien `npx prisma migrate deploy` si solo querés aplicar las migraciones existentes sin modo interactivo, seguido de `npx prisma generate`).*

### 3. Levantar la aplicación en el puerto 3001

Para iniciar el servidor de desarrollo en el puerto **3001**:

```bash
npm run dev
```

La aplicación estará disponible en:  
👉 **http://localhost:3001**

### Compilación y ejecución en modo producción (opcional)

Si deseás compilar y ejecutar la versión de producción en el puerto **3001**:

```bash
npm run build
npm run start
```

