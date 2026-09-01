CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '新对话' NOT NULL,
	`is_archived` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `host_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`context_id` text NOT NULL,
	`slot` text NOT NULL,
	`data` text NOT NULL,
	`type` text DEFAULT 'note' NOT NULL,
	`importance` text DEFAULT 'normal' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_host_memory_cid_ctx` ON `host_memory` (`conversation_id`,`context_id`);--> statement-breakpoint
CREATE INDEX `idx_host_memory_slot` ON `host_memory` (`conversation_id`,`context_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_host_memory_cid_ctx_slot` ON `host_memory` (`conversation_id`,`context_id`,`slot`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`context_id` text DEFAULT 'main' NOT NULL,
	`extra_data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_messages_role" CHECK("messages"."role" IN ('user','context'))
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plugin_data` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_context_daily` (
	`day` text NOT NULL,
	`context_id` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `context_id`)
);
--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_hourly` (
	`hour` text PRIMARY KEY NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`text_calls` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_totals` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
