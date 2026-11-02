CREATE TABLE `attendance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`event` enum('in','out') NOT NULL,
	`eventAt` timestamp NOT NULL DEFAULT (now()),
	`note` varchar(255),
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(160) NOT NULL,
	`role` enum('manager','cashier','stock') NOT NULL DEFAULT 'cashier',
	`permissions` text,
	`pinSalt` varchar(64) NOT NULL,
	`pinHash` varchar(128) NOT NULL,
	`phone` varchar(32),
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	CONSTRAINT `employees_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(191),
	`barcode` varchar(64),
	`name` varchar(255) NOT NULL,
	`cost` decimal(12,2) NOT NULL DEFAULT '0.00',
	`price` decimal(12,2) NOT NULL DEFAULT '0.00',
	`onHand` decimal(14,3) NOT NULL DEFAULT '0.000',
	`countedQty` decimal(14,3),
	`unit` varchar(48) NOT NULL DEFAULT 'قطعة',
	`location` varchar(128),
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_external_id_uq` UNIQUE(`externalId`),
	CONSTRAINT `products_barcode_uq` UNIQUE(`barcode`)
);
--> statement-breakpoint
CREATE TABLE `goods_receipt_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receiptId` int NOT NULL,
	`productId` int NOT NULL,
	`nameSnapshot` varchar(255) NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`cost` decimal(12,2) NOT NULL,
	`lineTotal` decimal(14,2) NOT NULL,
	CONSTRAINT `goods_receipt_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `goods_receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(48) NOT NULL,
	`supplier` varchar(180) NOT NULL,
	`invoiceNo` varchar(80),
	`employeeId` int NOT NULL,
	`totalCost` decimal(14,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `goods_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `goods_receipts_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`saleId` int NOT NULL,
	`productId` int NOT NULL,
	`nameSnapshot` varchar(255) NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`price` decimal(12,2) NOT NULL,
	`cost` decimal(12,2) NOT NULL,
	`lineTotal` decimal(14,2) NOT NULL,
	CONSTRAINT `sale_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receiptNo` varchar(40) NOT NULL,
	`employeeId` int NOT NULL,
	`shiftId` int,
	`subtotal` decimal(14,2) NOT NULL,
	`discount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total` decimal(14,2) NOT NULL,
	`paid` decimal(14,2) NOT NULL,
	`paymentMethod` enum('cash','card','wallet','credit','mixed') NOT NULL DEFAULT 'cash',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_receipt_no_uq` UNIQUE(`receiptNo`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeId` int NOT NULL,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`openingCash` decimal(12,2) NOT NULL DEFAULT '0.00',
	`expectedCash` decimal(12,2),
	`actualCash` decimal(12,2),
	`difference` decimal(12,2),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`employeeId` int,
	`kind` enum('opening','sale','receipt','count','manual') NOT NULL,
	`quantityDelta` decimal(14,3) NOT NULL,
	`reference` varchar(48),
	`note` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_sessions` ADD CONSTRAINT `employee_sessions_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_receiptId_goods_receipts_id_fk` FOREIGN KEY (`receiptId`) REFERENCES `goods_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_lines` ADD CONSTRAINT `sale_lines_saleId_sales_id_fk` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_lines` ADD CONSTRAINT `sale_lines_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_employeeId_employees_id_fk` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_employee_idx` ON `attendance` (`employeeId`);--> statement-breakpoint
CREATE INDEX `attendance_event_at_idx` ON `attendance` (`eventAt`);--> statement-breakpoint
CREATE INDEX `employee_sessions_employee_idx` ON `employee_sessions` (`employeeId`);--> statement-breakpoint
CREATE INDEX `employees_active_idx` ON `employees` (`active`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `goods_receipts_created_idx` ON `goods_receipts` (`createdAt`);--> statement-breakpoint
CREATE INDEX `sale_lines_sale_idx` ON `sale_lines` (`saleId`);--> statement-breakpoint
CREATE INDEX `sale_lines_product_idx` ON `sale_lines` (`productId`);--> statement-breakpoint
CREATE INDEX `sales_created_idx` ON `sales` (`createdAt`);--> statement-breakpoint
CREATE INDEX `sales_employee_idx` ON `sales` (`employeeId`);--> statement-breakpoint
CREATE INDEX `shifts_status_idx` ON `shifts` (`status`);--> statement-breakpoint
CREATE INDEX `shifts_employee_idx` ON `shifts` (`employeeId`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_idx` ON `stock_movements` (`productId`);--> statement-breakpoint
CREATE INDEX `stock_movements_created_idx` ON `stock_movements` (`createdAt`);