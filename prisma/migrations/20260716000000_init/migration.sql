CREATE TABLE `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(254) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `password_salt` CHAR(32) NOT NULL,
  `password_hash` CHAR(128) NOT NULL,
  `role` ENUM('admin', 'tenant') NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `users_email_unique` (`email`),
  CONSTRAINT `users_active_check` CHECK (`active` IN (0, 1))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
  `token_hash` CHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `expires_at` VARCHAR(32) NOT NULL,
  `created_at` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`token_hash`),
  INDEX `sessions_expiry_idx` (`expires_at`),
  CONSTRAINT `sessions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind` ENUM('invoice', 'contract', 'other') NOT NULL,
  `utility_type` ENUM('electricity', 'water', 'gas', 'other') NULL,
  `title` VARCHAR(120) NOT NULL,
  `period` VARCHAR(120) NULL,
  `amount_cents` BIGINT NULL,
  `due_date` CHAR(10) NULL,
  `status` ENUM('information', 'pending', 'paid', 'overdue') NOT NULL,
  `visibility` ENUM('shared', 'private') NOT NULL,
  `tenant_id` BIGINT UNSIGNED NULL,
  `storage_name` VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `created_at` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `documents_storage_name_unique` (`storage_name`),
  INDEX `documents_tenant_idx` (`tenant_id`),
  CONSTRAINT `documents_visibility_check` CHECK (
    (`visibility` = 'shared' AND `tenant_id` IS NULL)
    OR (`visibility` = 'private' AND `tenant_id` IS NOT NULL)
  ),
  CONSTRAINT `documents_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
