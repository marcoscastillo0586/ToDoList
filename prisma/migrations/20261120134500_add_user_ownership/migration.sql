-- Cada tarjeta (todo_lists) y cada actividad (activities) pasa a tener dueño.
--
-- Los datos que ya existían se asignan al primer usuario creado (el de menor id).
-- IMPORTANTE: si las tablas tienen datos, tiene que existir al menos un usuario
-- antes de aplicar esta migración (ver scripts/hash-password.mjs). Si no existe,
-- la migración falla en el paso 3 sin dejar datos con dueño equivocado.

-- 1. Columnas nuevas, por ahora opcionales
ALTER TABLE `todo_lists` ADD COLUMN `user_id` INTEGER NULL;
ALTER TABLE `activities` ADD COLUMN `user_id` INTEGER NULL;

-- 2. Asignar los datos existentes al primer usuario
UPDATE `todo_lists` SET `user_id` = (SELECT MIN(`id`) FROM `users`) WHERE `user_id` IS NULL;
UPDATE `activities` a
  JOIN `todo_lists` l ON l.`id` = a.`listId`
  SET a.`user_id` = l.`user_id`
  WHERE a.`user_id` IS NULL;

-- 3. Ahora sí, obligatorias
ALTER TABLE `todo_lists` MODIFY `user_id` INTEGER NOT NULL;
ALTER TABLE `activities` MODIFY `user_id` INTEGER NOT NULL;

-- 4. Índices
CREATE INDEX `todo_lists_user_id_idx` ON `todo_lists`(`user_id`);
CREATE UNIQUE INDEX `todo_lists_id_user_id_key` ON `todo_lists`(`id`, `user_id`);
CREATE INDEX `activities_user_id_idx` ON `activities`(`user_id`);

-- 5. Claves foráneas. La de actividad -> (lista, dueño) reemplaza a la de actividad -> lista
--    y garantiza que una actividad tenga siempre el mismo dueño que su lista.
ALTER TABLE `activities` DROP FOREIGN KEY `activities_listId_fkey`;

ALTER TABLE `todo_lists` ADD CONSTRAINT `todo_lists_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `activities` ADD CONSTRAINT `activities_listId_user_id_fkey`
  FOREIGN KEY (`listId`, `user_id`) REFERENCES `todo_lists`(`id`, `user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `activities` ADD CONSTRAINT `activities_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
