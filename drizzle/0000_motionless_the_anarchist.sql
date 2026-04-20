CREATE TABLE `consumers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes` text NOT NULL,
	`revoked_at` integer,
	`expires_at` integer,
	`rate_limit_rpm` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
