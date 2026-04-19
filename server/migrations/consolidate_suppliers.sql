-- Consolidate inv_suppliers into suppliers
-- Run once. Safe to re-run (INSERT IGNORE skips duplicates by UUID).

-- 1. Migrate any inv_suppliers rows not already in suppliers
INSERT IGNORE INTO `suppliers` (
  `id`, `code`, `name`, `contact_person`, `phone`, `email`,
  `address`, `city`, `terms`, `notes`, `is_active`,
  `created_by`, `created_at`, `updated_at`
)
SELECT
  `id`, `code`, `name`, `contact_person`, `phone`, `email`,
  `address`, `city`, `payment_terms`, `notes`, `is_active`,
  `created_by`, `created_at`, `updated_at`
FROM `inv_suppliers`;

-- 2. Drop the now-redundant table
DROP TABLE IF EXISTS `inv_suppliers`;
