-- AlterTable
ALTER TABLE `activities` ADD COLUMN `parentId` INTEGER NULL,
    MODIFY `startDate` DATETIME(3) NULL,
    MODIFY `estimatedAmount` DOUBLE NULL,
    MODIFY `estimatedUnit` ENUM('MINUTES', 'HOURS', 'DAYS') NULL,
    MODIFY `estimatedEndDate` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `activities_parentId_idx` ON `activities`(`parentId`);

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `activities`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
