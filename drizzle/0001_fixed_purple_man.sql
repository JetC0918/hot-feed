CREATE TABLE `summary_generation_lease` (
	`url_hash` text PRIMARY KEY NOT NULL,
	`lease_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
