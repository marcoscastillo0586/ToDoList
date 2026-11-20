-- CreateTable
CREATE TABLE `todo_lists` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `listId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `estimatedAmount` DOUBLE NOT NULL,
    `estimatedUnit` ENUM('MINUTES', 'HOURS', 'DAYS') NOT NULL,
    `estimatedEndDate` DATETIME(3) NOT NULL,
    `actualEndDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `activities_listId_idx`(`listId`),
    INDEX `activities_actualEndDate_idx`(`actualEndDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `todo_lists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
