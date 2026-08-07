CREATE TABLE `summary_cache` (
	`url_hash` text PRIMARY KEY NOT NULL,
	`canonical_url` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`basis` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL
);
