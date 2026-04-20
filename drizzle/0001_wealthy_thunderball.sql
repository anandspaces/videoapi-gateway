ALTER TABLE `consumers` ADD `email` text;--> statement-breakpoint
ALTER TABLE `consumers` ADD `password_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `consumers_email_unique` ON `consumers` (`email`);