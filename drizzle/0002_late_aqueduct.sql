CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(80) NOT NULL,
	`description` varchar(255) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`paymentMethod` enum('cash','card','wallet') NOT NULL DEFAULT 'cash',
	`shiftId` int,
	`employeeId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `expenses_created_idx` ON `expenses` (`createdAt`);--> statement-breakpoint
CREATE INDEX `expenses_shift_idx` ON `expenses` (`shiftId`);