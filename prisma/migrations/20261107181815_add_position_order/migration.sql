-- AlterTable
ALTER TABLE `activities` ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `todo_lists` ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0;
