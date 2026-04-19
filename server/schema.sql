-- BizTracker MySQL Schema
-- Compatible with MySQL 8.0+ and MySQL 9.x
SET FOREIGN_KEY_CHECKS = 0;
SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci';

-- MySQL dump 10.13  Distrib 8.0.45, for Win64 (x86_64)
--
-- Host: localhost    Database: gcash_pos
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `accounts`
--

DROP TABLE IF EXISTS `accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `accounts` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(255) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `current_beginning_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `current_running_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `last_closed_date` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `adjustment_items`
--

DROP TABLE IF EXISTS `adjustment_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `adjustment_items` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `adjustment_id` char(36) NOT NULL,
  `product_id` char(36) NOT NULL,
  `qty_before` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_adjusted` decimal(12,3) NOT NULL,
  `qty_after` decimal(12,3) NOT NULL DEFAULT '0.000',
  `reason` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `adjustment_id` (`adjustment_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `adjustment_items_ibfk_1` FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `adjustment_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `adjustments`
--

DROP TABLE IF EXISTS `adjustments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `adjustments` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `adj_number` varchar(50) NOT NULL,
  `location_id` char(36) NOT NULL,
  `adj_type` varchar(30) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `adj_date` date NOT NULL DEFAULT (curdate()),
  `reason` text NOT NULL,
  `posted_by` char(36) DEFAULT NULL,
  `posted_at` datetime DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `adj_number` (`adj_number`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `adjustments_ibfk_1` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `adjustments_chk_1` CHECK ((`adj_type` in (_cp850'addition',_cp850'deduction',_cp850'write_off',_cp850'correction'))),
  CONSTRAINT `adjustments_chk_2` CHECK ((`status` in (_cp850'draft',_cp850'posted',_cp850'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `table_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `record_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `changes` json DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_user` (`user_id`),
  KEY `idx_audit_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bank_accounts`
--

DROP TABLE IF EXISTS `bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_accounts` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(255) NOT NULL,
  `bank_name` varchar(255) NOT NULL DEFAULT '',
  `account_number` varchar(255) NOT NULL DEFAULT '',
  `beginning_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `current_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bank_deposits`
--

DROP TABLE IF EXISTS `bank_deposits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_deposits` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `bank_account_id` char(36) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `date` date NOT NULL,
  `description` text NOT NULL,
  `reference_number` varchar(255) NOT NULL DEFAULT '',
  `source_type` varchar(50) NOT NULL DEFAULT '',
  `source_description` varchar(255) NOT NULL DEFAULT '',
  `notes` text,
  `status` varchar(20) NOT NULL DEFAULT 'verified',
  `deposited_at` datetime DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  `verified_by` char(36) DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `source_transaction_id` char(36) DEFAULT NULL,
  `cashier_remittance_id` char(36) DEFAULT NULL,
  `source_module` varchar(50) DEFAULT NULL,
  `attachment_reference` varchar(255) DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `bank_account_id` (`bank_account_id`),
  CONSTRAINT `bank_deposits_ibfk_1` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bank_reconciliations`
--

DROP TABLE IF EXISTS `bank_reconciliations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_reconciliations` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `bank_account_id` char(36) NOT NULL,
  `statement_date` date NOT NULL,
  `statement_ending_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `system_book_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `uncleared_checks_total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `deposits_in_transit_total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `adjusted_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `variance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `remarks` text,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `created_by` char(36) DEFAULT NULL,
  `reviewed_by` char(36) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `finalized_by` char(36) DEFAULT NULL,
  `finalized_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bank_transactions`
--

DROP TABLE IF EXISTS `bank_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_transactions` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `bank_account_id` char(36) NOT NULL,
  `transaction_type` varchar(30) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `direction` varchar(10) NOT NULL DEFAULT 'debit',
  `date` date NOT NULL,
  `description` text NOT NULL,
  `notes` text,
  `reference_number` varchar(255) NOT NULL DEFAULT '',
  `source_transaction_id` char(36) DEFAULT NULL,
  `check_id` char(36) DEFAULT NULL,
  `payable_id` char(36) DEFAULT NULL,
  `balance_after` decimal(12,2) DEFAULT NULL,
  `module_source` varchar(50) DEFAULT NULL,
  `attachment_reference` varchar(255) DEFAULT NULL,
  `disbursement_id` char(36) DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `bank_account_id` (`bank_account_id`),
  CONSTRAINT `bank_transactions_ibfk_1` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `bank_transactions_type_chk` CHECK ((`transaction_type` in (_utf8mb4'deposit',_utf8mb4'withdrawal',_utf8mb4'interest_income',_utf8mb4'bank_fee',_utf8mb4'check_payment',_utf8mb4'disbursement',_utf8mb4'adjustment',_utf8mb4'transfer_in',_utf8mb4'transfer_out',_utf8mb4'owner_funding',_utf8mb4'owner_withdrawal')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cash_daily_history`
--

DROP TABLE IF EXISTS `cash_daily_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_daily_history` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `date` date NOT NULL,
  `beginning_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_cash_in` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_cash_out` decimal(12,2) NOT NULL DEFAULT '0.00',
  `transaction_count` int NOT NULL DEFAULT '0',
  `cash_fees_collected` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cash_given_out` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cash_out_to_fund` decimal(12,2) NOT NULL DEFAULT '0.00',
  `bank_deposits` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cash_fund_disbursements` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ending_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `posted_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `posted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cash_transactions`
--

DROP TABLE IF EXISTS `cash_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_transactions` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `transaction_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_category` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular',
  `amount` decimal(12,2) NOT NULL,
  `date` date NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `reference_number` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `cash_out_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_module` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_reference_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `disbursement_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_pos_remittance_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `is_closed` tinyint(1) NOT NULL DEFAULT '0',
  `cleared_at` datetime DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cash_transactions_chk_1` CHECK ((`transaction_type` in (_utf8mb4'beginning_balance',_utf8mb4'bank_deposit',_utf8mb4'cash_fund_disbursement',_utf8mb4'pos_remittance',_utf8mb4'cash_in',_utf8mb4'cash_out')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cashier_remittances`
--

DROP TABLE IF EXISTS `cashier_remittances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cashier_remittances` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `cashier_id` char(36) NOT NULL,
  `source_type` varchar(30) NOT NULL DEFAULT 'gcash',
  `source_account_id` char(36) DEFAULT NULL,
  `source_bank_id` char(36) DEFAULT NULL,
  `destination_type` varchar(30) NOT NULL DEFAULT 'bank',
  `destination_bank_id` char(36) DEFAULT NULL,
  `destination_account_id` char(36) DEFAULT NULL,
  `shift_id` char(36) DEFAULT NULL,
  `date` date NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `bank_fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notes` text,
  `description` text NOT NULL,
  `reference_number` varchar(255) NOT NULL DEFAULT '',
  `attachment_reference` varchar(255) DEFAULT NULL,
  `source_transaction_id` char(36) DEFAULT NULL,
  `destination_transaction_id` char(36) DEFAULT NULL,
  `approval_required` tinyint(1) NOT NULL DEFAULT '0',
  `approval_status` varchar(20) NOT NULL DEFAULT 'approved',
  `approved_by` char(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'pending',
  `confirmed_by` char(36) DEFAULT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `cashier_remittances_chk_1` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'confirmed',_utf8mb4'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checks_issued`
--

DROP TABLE IF EXISTS `checks_issued`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `checks_issued` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `bank_account_id` char(36) NOT NULL,
  `supplier_id` char(36) DEFAULT NULL,
  `payable_id` char(36) DEFAULT NULL,
  `check_number` varchar(100) NOT NULL,
  `check_date` date DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `date` date NOT NULL,
  `issued_date` date DEFAULT NULL,
  `payee` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `notes` text,
  `attachment_reference` varchar(255) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'draft',
  `cleared_date` date DEFAULT NULL,
  `disbursement_id` char(36) DEFAULT NULL,
  `manually_set_status` tinyint(1) NOT NULL DEFAULT '0',
  `approval_required` tinyint(1) NOT NULL DEFAULT '0',
  `approval_status` varchar(20) NOT NULL DEFAULT 'approved',
  `approved_by` char(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_reason` text,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `bank_account_id` (`bank_account_id`),
  CONSTRAINT `checks_issued_ibfk_1` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `checks_issued_status_chk` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'pending',_utf8mb4'pdc',_utf8mb4'outstanding',_utf8mb4'cleared',_utf8mb4'cancelled',_utf8mb4'bounced',_utf8mb4'stale')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `company_settings`
--

DROP TABLE IF EXISTS `company_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `company_settings` (
  `id` int NOT NULL DEFAULT '1',
  `company_name` varchar(255) NOT NULL DEFAULT 'My Business',
  `company_address` text,
  `contact_number` varchar(50) NOT NULL DEFAULT '',
  `email` varchar(255) NOT NULL DEFAULT '',
  `website` varchar(255) NOT NULL DEFAULT '',
  `tin` varchar(50) NOT NULL DEFAULT '',
  `business_type` varchar(100) NOT NULL DEFAULT '',
  `branch_name` varchar(100) NOT NULL DEFAULT '',
  `default_currency` varchar(10) NOT NULL DEFAULT 'PHP',
  `app_title` varchar(255) NOT NULL DEFAULT '',
  `show_company_header_in_reports` tinyint(1) NOT NULL DEFAULT '1',
  `show_logo_in_reports` tinyint(1) NOT NULL DEFAULT '1',
  `logo_url` varchar(500) NOT NULL DEFAULT '',
  `footer_notes` text,
  `receipt_notes` text,
  `payslip_footer_notes` text,
  `publisher` varchar(100) NOT NULL DEFAULT 'Cebu DigiBox',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `receipt_printer_name` varchar(255) NOT NULL DEFAULT 'XPrinter 58IIH',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customer_credit_ledger`
--

DROP TABLE IF EXISTS `customer_credit_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_credit_ledger` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `customer_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entry_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'charge',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `balance_before` decimal(12,2) NOT NULL DEFAULT '0.00',
  `balance_after` decimal(12,2) NOT NULL DEFAULT '0.00',
  `payment_method` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash',
  `payment_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `reference_number` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `target_account_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `target_account_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_account_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `accounting_entry_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sale_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_credit_ledger_customer` (`customer_id`),
  KEY `idx_customer_credit_ledger_sale` (`sale_id`),
  KEY `idx_customer_credit_ledger_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `daily_history`
--

DROP TABLE IF EXISTS `daily_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_history` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `account_id` char(36) NOT NULL,
  `date` date NOT NULL,
  `beginning_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_cash_in` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_cash_out` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_transaction_fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_cash_fees` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_delivery_fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `transaction_count` int NOT NULL DEFAULT '0',
  `ending_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `posted_by` char(36) DEFAULT NULL,
  `shift_cash_in` decimal(12,2) NOT NULL DEFAULT '0.00',
  `shift_cash_out` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_daily_history` (`account_id`,`date`),
  CONSTRAINT `daily_history_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `daily_sales`
--

DROP TABLE IF EXISTS `daily_sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_sales` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `date` date NOT NULL,
  `sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cost_of_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `description` text,
  `total_pos_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cash_pos_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gcash_pos_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `card_pos_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `pos_synced_at` datetime DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `total_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cash_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gcash_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `card_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notes` text NOT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `disbursements`
--

DROP TABLE IF EXISTS `disbursements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `disbursements` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `supplier_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `affects_cashflow` tinyint(1) NOT NULL DEFAULT '1',
  `date` date NOT NULL,
  `payee` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `purpose` text COLLATE utf8mb4_unicode_ci,
  `payment_method` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash',
  `check_number` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference_number` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `disbursement_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash',
  `source_module` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_reference_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_account_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_account_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `check_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_ledger_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_time_logs`
--

DROP TABLE IF EXISTS `employee_time_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_time_logs` (
  `id` varchar(36) NOT NULL,
  `employee_id` varchar(36) NOT NULL,
  `log_date` date NOT NULL,
  `log_time` time NOT NULL,
  `log_type` enum('TIME_IN','TIME_OUT') NOT NULL,
  `device_name` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_etl_employee_date` (`employee_id`,`log_date`),
  KEY `idx_etl_log_date` (`log_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `finance_owner_movements`
--

DROP TABLE IF EXISTS `finance_owner_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `finance_owner_movements` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `date` date NOT NULL,
  `movement_type` varchar(20) NOT NULL DEFAULT 'funding',
  `target_module` varchar(20) NOT NULL DEFAULT 'bank',
  `owner_id` char(36) DEFAULT NULL,
  `bank_account_id` char(36) DEFAULT NULL,
  `account_id` char(36) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `reference_number` varchar(120) NOT NULL DEFAULT '',
  `remarks` text,
  `attachment_reference` varchar(255) DEFAULT NULL,
  `approval_required` tinyint(1) NOT NULL DEFAULT '0',
  `approval_status` varchar(20) NOT NULL DEFAULT 'approved',
  `approved_by` char(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `posted_bank_transaction_id` char(36) DEFAULT NULL,
  `posted_transaction_id` char(36) DEFAULT NULL,
  `posted_cash_transaction_id` char(36) DEFAULT NULL,
  `owner_ledger_id` char(36) DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `finance_owners`
--

DROP TABLE IF EXISTS `finance_owners`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `finance_owners` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(120) NOT NULL,
  `remarks` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `held_sale_items`
--

DROP TABLE IF EXISTS `held_sale_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `held_sale_items` (
  `item_id` char(36) NOT NULL DEFAULT (uuid()),
  `held_sale_id` char(36) NOT NULL,
  `product_id` char(36) DEFAULT NULL,
  `barcode` varchar(100) NOT NULL DEFAULT '',
  `sku_code` varchar(100) NOT NULL DEFAULT '',
  `product_name_snapshot` varchar(255) NOT NULL DEFAULT '',
  `qty` decimal(12,4) NOT NULL,
  `retail_unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `unit_price` decimal(12,2) NOT NULL,
  `wholesale_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `wholesale_break_qty_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `wholesale_block_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wholesale_blocks_applied` int NOT NULL DEFAULT '0',
  `wholesale_base_qty_applied` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `retail_remainder_base_qty` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `pricing_breakdown` varchar(255) NOT NULL DEFAULT '',
  `selected_price_level` varchar(20) NOT NULL DEFAULT 'Retail',
  `applied_price_level` varchar(20) NOT NULL DEFAULT 'Retail',
  `price_source` varchar(30) NOT NULL DEFAULT 'Retail',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sort_order` int NOT NULL DEFAULT '0',
  `selected_unit_id` char(36) DEFAULT NULL,
  `selected_unit_name` varchar(100) NOT NULL DEFAULT '',
  `qty_in_base_unit_per_unit` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `total_base_qty_deducted` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `base_unit_name` varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (`item_id`),
  KEY `held_sale_id` (`held_sale_id`),
  CONSTRAINT `held_sale_items_ibfk_1` FOREIGN KEY (`held_sale_id`) REFERENCES `held_sales` (`held_sale_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `held_sales`
--

DROP TABLE IF EXISTS `held_sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `held_sales` (
  `held_sale_id` char(36) NOT NULL DEFAULT (uuid()),
  `shift_id` char(36) NOT NULL,
  `terminal_id` char(36) NOT NULL,
  `cashier_id` char(36) NOT NULL,
  `hold_reference` varchar(20) NOT NULL DEFAULT '',
  `customer_id` char(36) DEFAULT NULL,
  `customer_name_snapshot` varchar(255) NOT NULL DEFAULT 'Walk-in',
  `customer_price_level_snapshot` varchar(20) NOT NULL DEFAULT 'Retail',
  `status` varchar(20) NOT NULL DEFAULT 'held',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notes` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`held_sale_id`),
  UNIQUE KEY `hold_reference` (`hold_reference`),
  CONSTRAINT `held_sales_chk_1` CHECK ((`status` in (_utf8mb4'held',_utf8mb4'recalled',_utf8mb4'expired',_utf8mb4'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hr_departments`
--

DROP TABLE IF EXISTS `hr_departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_departments` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hr_employees`
--

DROP TABLE IF EXISTS `hr_employees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_employees` (
  `id` varchar(36) NOT NULL,
  `employee_code` varchar(50) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) NOT NULL,
  `gender` enum('Male','Female','Other') DEFAULT 'Male',
  `birthdate` date DEFAULT NULL,
  `civil_status` enum('Single','Married','Widowed','Separated') DEFAULT 'Single',
  `address` text,
  `mobile` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `emergency_contact_name` varchar(150) DEFAULT NULL,
  `emergency_contact_phone` varchar(30) DEFAULT NULL,
  `date_hired` date DEFAULT NULL,
  `employment_status` enum('Regular','Probationary','Contractual','Part-time') DEFAULT 'Regular',
  `department_id` varchar(36) DEFAULT NULL,
  `position_id` varchar(36) DEFAULT NULL,
  `branch` varchar(100) DEFAULT NULL,
  `payroll_type` enum('Monthly','Daily') DEFAULT 'Monthly',
  `basic_monthly_rate` decimal(12,2) DEFAULT '0.00',
  `daily_rate` decimal(12,2) DEFAULT '0.00',
  `hourly_rate` decimal(12,4) DEFAULT '0.0000',
  `rest_day` enum('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') DEFAULT 'Sunday',
  `tax_type` enum('Taxable','Non-taxable','Minimum Wage') DEFAULT 'Taxable',
  `sss_number` varchar(30) DEFAULT NULL,
  `philhealth_number` varchar(30) DEFAULT NULL,
  `pagibig_number` varchar(30) DEFAULT NULL,
  `tin` varchar(30) DEFAULT NULL,
  `bank_account` varchar(100) DEFAULT NULL,
  `payment_method` enum('Cash','ATM/Bank','GCash','Check') DEFAULT 'Cash',
  `overtime_eligible` tinyint(1) DEFAULT '1',
  `holiday_pay_eligible` tinyint(1) DEFAULT '1',
  `fixed_allowance` decimal(12,2) DEFAULT '0.00',
  `notes` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_code` (`employee_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hr_positions`
--

DROP TABLE IF EXISTS `hr_positions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_positions` (
  `id` varchar(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `department_id` varchar(36) DEFAULT NULL,
  `description` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hr_rate_history`
--

DROP TABLE IF EXISTS `hr_rate_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_rate_history` (
  `id` varchar(36) NOT NULL,
  `employee_id` varchar(36) NOT NULL,
  `effective_date` date NOT NULL,
  `old_monthly_rate` decimal(12,2) DEFAULT '0.00',
  `new_monthly_rate` decimal(12,2) DEFAULT '0.00',
  `old_daily_rate` decimal(12,2) DEFAULT '0.00',
  `new_daily_rate` decimal(12,2) DEFAULT '0.00',
  `reason` text,
  `updated_by` varchar(150) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_brands`
--

DROP TABLE IF EXISTS `inv_brands`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_brands` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_categories`
--

DROP TABLE IF EXISTS `inv_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_categories` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `inv_categories_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `inv_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_locations`
--

DROP TABLE IF EXISTS `inv_locations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_locations` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `code` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `address` text NOT NULL,
  `city` varchar(255) NOT NULL DEFAULT '',
  `phone` varchar(50) NOT NULL DEFAULT '',
  `manager_name` varchar(255) NOT NULL DEFAULT '',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_product_pricing_history`
--

DROP TABLE IF EXISTS `inv_product_pricing_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_product_pricing_history` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `product_id` char(36) NOT NULL,
  `old_cost` decimal(12,2) DEFAULT NULL,
  `new_cost` decimal(12,2) DEFAULT NULL,
  `old_retail_price` decimal(12,2) DEFAULT NULL,
  `new_retail_price` decimal(12,2) DEFAULT NULL,
  `old_wholesale_price` decimal(12,2) DEFAULT NULL,
  `new_wholesale_price` decimal(12,2) DEFAULT NULL,
  `old_special_price` decimal(12,2) DEFAULT NULL,
  `new_special_price` decimal(12,2) DEFAULT NULL,
  `changed_by` char(36) DEFAULT NULL,
  `changed_by_name` varchar(255) NOT NULL DEFAULT '',
  `changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inv_product_pricing_history_product` (`product_id`),
  KEY `idx_inv_product_pricing_history_changed_at` (`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_product_selling_units`
--

DROP TABLE IF EXISTS `inv_product_selling_units`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_product_selling_units` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `product_id` char(36) NOT NULL,
  `unit_id` char(36) NOT NULL,
  `qty_in_base_unit` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `selling_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `retail_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wholesale_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `special_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wholesale_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `wholesale_break_qty_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `wholesale_block_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_selling_unit` (`product_id`,`unit_id`),
  KEY `unit_id` (`unit_id`),
  CONSTRAINT `inv_product_selling_units_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_product_selling_units_ibfk_2` FOREIGN KEY (`unit_id`) REFERENCES `inv_units` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_product_unit_conversions`
--

DROP TABLE IF EXISTS `inv_product_unit_conversions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_product_unit_conversions` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `product_id` char(36) NOT NULL,
  `unit_id` char(36) NOT NULL,
  `equivalent_qty_in_base_unit` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `allow_purchase` tinyint(1) NOT NULL DEFAULT '0',
  `allow_sale` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_unit_conversion` (`product_id`,`unit_id`),
  KEY `unit_id` (`unit_id`),
  CONSTRAINT `inv_product_unit_conversions_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_product_unit_conversions_ibfk_2` FOREIGN KEY (`unit_id`) REFERENCES `inv_units` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_products`
--

DROP TABLE IF EXISTS `inv_products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_products` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `sku_code` varchar(100) NOT NULL,
  `barcode` varchar(100) NOT NULL DEFAULT '',
  `barcode2` varchar(100) NOT NULL DEFAULT '',
  `name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `category_id` char(36) DEFAULT NULL,
  `brand_id` char(36) DEFAULT NULL,
  `unit_id` char(36) DEFAULT NULL,
  `supplier_id` char(36) DEFAULT NULL,
  `cost_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `retail_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wholesale_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `special_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `selling_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `reorder_point` decimal(12,3) NOT NULL DEFAULT '0.000',
  `is_expiry_tracked` tinyint(1) NOT NULL DEFAULT '0',
  `near_expiry_days` int NOT NULL DEFAULT '90',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `base_unit_id` char(36) DEFAULT NULL,
  `default_purchase_unit_id` char(36) DEFAULT NULL,
  `default_selling_unit_id` char(36) DEFAULT NULL,
  `default_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `sku_code` (`sku_code`),
  KEY `category_id` (`category_id`),
  KEY `brand_id` (`brand_id`),
  KEY `unit_id` (`unit_id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `idx_inv_products_sku` (`sku_code`),
  KEY `idx_inv_products_barcode` (`barcode`),
  CONSTRAINT `inv_products_ibfk_2` FOREIGN KEY (`brand_id`) REFERENCES `inv_brands` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_products_ibfk_3` FOREIGN KEY (`unit_id`) REFERENCES `inv_units` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_roles`
--

DROP TABLE IF EXISTS `inv_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_roles` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(100) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `permissions` json NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_suppliers`
--

DROP TABLE IF EXISTS `inv_suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_suppliers` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_person` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `address` text COLLATE utf8mb4_unicode_ci,
  `city` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `payment_terms` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `notes` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_units`
--

DROP TABLE IF EXISTS `inv_units`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_units` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `abbreviation` varchar(20) NOT NULL DEFAULT '',
  `short_name` varchar(20) NOT NULL DEFAULT '',
  `description` text,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inventory_balances`
--

DROP TABLE IF EXISTS `inventory_balances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_balances` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `product_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `qty_on_hand` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_available` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `last_movement_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inv_balance` (`product_id`,`location_id`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `inventory_balances_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `inventory_balances_ibfk_2` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inventory_movements`
--

DROP TABLE IF EXISTS `inventory_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_movements` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `product_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `movement_type` varchar(50) NOT NULL,
  `qty_change` decimal(12,3) NOT NULL,
  `qty_after` decimal(12,3) NOT NULL DEFAULT '0.000',
  `ref_number` varchar(255) NOT NULL DEFAULT '',
  `ref_id` char(36) DEFAULT NULL,
  `notes` text NOT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `qty_before` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `unit_cost` decimal(12,6) DEFAULT NULL,
  `related_location_id` char(36) DEFAULT NULL,
  `display_unit_id` char(36) DEFAULT NULL,
  `display_unit_name` varchar(100) NOT NULL DEFAULT '',
  `display_qty` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `qty_in_base_unit_per_display` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `base_unit_id` char(36) DEFAULT NULL,
  `base_unit_name` varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `location_id` (`location_id`),
  KEY `idx_inv_movements_product_location` (`product_id`,`location_id`),
  CONSTRAINT `inventory_movements_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `inventory_movements_ibfk_2` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `owner_ledger`
--

DROP TABLE IF EXISTS `owner_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `owner_ledger` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `owner_id` char(36) NOT NULL,
  `transaction_date` date NOT NULL,
  `transaction_type` varchar(60) NOT NULL,
  `reference_type` varchar(60) NOT NULL DEFAULT '',
  `reference_id` char(36) DEFAULT NULL,
  `source_module` varchar(60) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `increase_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `decrease_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `running_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `source_account_type` varchar(30) DEFAULT NULL,
  `source_account_id` char(36) DEFAULT NULL,
  `reference_number` varchar(120) NOT NULL DEFAULT '',
  `remarks` text,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_owner_ledger_reference` (`owner_id`,`transaction_type`,`reference_type`,`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pagibig_table`
--

DROP TABLE IF EXISTS `pagibig_table`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagibig_table` (
  `id` varchar(36) NOT NULL,
  `year` int NOT NULL,
  `employee_rate_percent` decimal(5,2) NOT NULL DEFAULT '2.00',
  `employer_rate_percent` decimal(5,2) NOT NULL DEFAULT '2.00',
  `max_employee_contribution` decimal(10,2) NOT NULL DEFAULT '100.00',
  `max_employer_contribution` decimal(10,2) NOT NULL DEFAULT '100.00',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payable_payments`
--

DROP TABLE IF EXISTS `payable_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payable_payments` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `payable_id` char(36) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_date` date NOT NULL DEFAULT (curdate()),
  `payment_method` varchar(50) NOT NULL DEFAULT 'cash',
  `reference_number` varchar(100) NOT NULL DEFAULT '',
  `remarks` text,
  `owner_id` char(36) DEFAULT NULL,
  `bank_account_id` char(36) DEFAULT NULL,
  `check_id` char(36) DEFAULT NULL,
  `bank_transaction_id` char(36) DEFAULT NULL,
  `owner_ledger_id` char(36) DEFAULT NULL,
  `attachment_reference` varchar(255) DEFAULT NULL,
  `approval_required` tinyint(1) NOT NULL DEFAULT '0',
  `approval_status` varchar(20) NOT NULL DEFAULT 'approved',
  `approved_by` char(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `reference_no` varchar(100) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `payable_id` (`payable_id`),
  CONSTRAINT `payable_payments_ibfk_1` FOREIGN KEY (`payable_id`) REFERENCES `payables` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payables`
--

DROP TABLE IF EXISTS `payables`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payables` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `payable_number` varchar(50) NOT NULL,
  `supplier_id` char(36) NOT NULL,
  `receiving_id` char(36) DEFAULT NULL,
  `invoice_number` varchar(100) NOT NULL DEFAULT '',
  `amount` decimal(12,2) NOT NULL,
  `balance` decimal(12,2) NOT NULL,
  `due_date` date DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'open',
  `notes` text NOT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payable_number` (`payable_number`),
  KEY `supplier_id` (`supplier_id`),
  KEY `receiving_id` (`receiving_id`),
  CONSTRAINT `payables_ibfk_2` FOREIGN KEY (`receiving_id`) REFERENCES `receivings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `payables_chk_1` CHECK ((`status` in (_utf8mb4'open',_utf8mb4'partial',_utf8mb4'paid',_utf8mb4'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_attendance`
--

DROP TABLE IF EXISTS `payroll_attendance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_attendance` (
  `id` varchar(36) NOT NULL,
  `employee_id` varchar(36) NOT NULL,
  `cutoff_id` varchar(36) DEFAULT NULL,
  `work_date` date NOT NULL,
  `time_in` time DEFAULT NULL,
  `time_out` time DEFAULT NULL,
  `hours_worked` decimal(5,2) DEFAULT '0.00',
  `late_minutes` decimal(6,2) DEFAULT '0.00',
  `undertime_minutes` decimal(6,2) DEFAULT '0.00',
  `overtime_hours` decimal(5,2) DEFAULT '0.00',
  `is_absent` tinyint(1) DEFAULT '0',
  `is_rest_day` tinyint(1) DEFAULT '0',
  `holiday_type` enum('None','Legal','Special') DEFAULT 'None',
  `holiday_name` varchar(100) DEFAULT NULL,
  `remarks` varchar(255) DEFAULT NULL,
  `source` enum('Manual','Biometrics') DEFAULT 'Manual',
  `batch_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_date` (`employee_id`,`work_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_biometrics_batches`
--

DROP TABLE IF EXISTS `payroll_biometrics_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_biometrics_batches` (
  `id` varchar(36) NOT NULL,
  `batch_name` varchar(200) NOT NULL,
  `cutoff_id` varchar(36) DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `row_count` int DEFAULT '0',
  `imported_count` int DEFAULT '0',
  `skipped_count` int DEFAULT '0',
  `error_count` int DEFAULT '0',
  `status` enum('Preview','Imported','Error') DEFAULT 'Preview',
  `created_by` varchar(150) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_cash_advances`
--

DROP TABLE IF EXISTS `payroll_cash_advances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_cash_advances` (
  `id` varchar(36) NOT NULL,
  `employee_id` varchar(36) NOT NULL,
  `date_granted` date NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `deduction_per_cutoff` decimal(12,2) DEFAULT '0.00',
  `deduction_mode` enum('every_cutoff','every_other','every_other_2nd','manual') NOT NULL DEFAULT 'every_cutoff',
  `status` enum('Active','Settled','Cancelled') DEFAULT 'Active',
  `remarks` text,
  `created_by` varchar(150) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_cutoffs`
--

DROP TABLE IF EXISTS `payroll_cutoffs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_cutoffs` (
  `id` varchar(36) NOT NULL,
  `period_name` varchar(100) NOT NULL,
  `date_from` date NOT NULL,
  `date_to` date NOT NULL,
  `payroll_month` int NOT NULL,
  `payroll_year` int NOT NULL,
  `cutoff_seq` tinyint NOT NULL COMMENT '1=first half, 2=second half',
  `status` enum('Open','Processing','Finalized') NOT NULL DEFAULT 'Open',
  `notes` text,
  `created_by` varchar(150) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_deduction_types`
--

DROP TABLE IF EXISTS `payroll_deduction_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_deduction_types` (
  `id` varchar(36) NOT NULL,
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_statutory` tinyint(1) DEFAULT '0' COMMENT '1=SSS/PhilHealth/PagIBIG/Tax',
  `is_system` tinyint(1) DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_earnings_types`
--

DROP TABLE IF EXISTS `payroll_earnings_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_earnings_types` (
  `id` varchar(36) NOT NULL,
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_taxable` tinyint(1) DEFAULT '1',
  `is_system` tinyint(1) DEFAULT '0' COMMENT 'System types cannot be deleted',
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_holidays`
--

DROP TABLE IF EXISTS `payroll_holidays`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_holidays` (
  `id` varchar(36) NOT NULL,
  `holiday_name` varchar(200) NOT NULL,
  `holiday_date` date NOT NULL,
  `holiday_type` enum('Legal','Special') NOT NULL DEFAULT 'Legal',
  `is_recurring` tinyint(1) DEFAULT '0',
  `year` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_run_item_lines`
--

DROP TABLE IF EXISTS `payroll_run_item_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_run_item_lines` (
  `id` varchar(36) NOT NULL,
  `run_item_id` varchar(36) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `line_type` enum('Earning','Deduction') NOT NULL,
  `code` varchar(30) NOT NULL,
  `name` varchar(150) NOT NULL,
  `amount` decimal(12,2) DEFAULT '0.00',
  `sort_order` int DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_run_items`
--

DROP TABLE IF EXISTS `payroll_run_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_run_items` (
  `id` varchar(36) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `cutoff_id` varchar(36) NOT NULL,
  `employee_id` varchar(36) NOT NULL,
  `employee_code` varchar(50) DEFAULT NULL,
  `employee_name` varchar(255) DEFAULT NULL,
  `department` varchar(100) DEFAULT NULL,
  `position` varchar(100) DEFAULT NULL,
  `payroll_type` varchar(20) DEFAULT NULL,
  `basic_monthly_rate` decimal(12,2) DEFAULT '0.00',
  `daily_rate` decimal(12,2) DEFAULT '0.00',
  `days_in_period` decimal(5,2) DEFAULT '0.00',
  `days_worked` decimal(5,2) DEFAULT '0.00',
  `days_absent` decimal(5,2) DEFAULT '0.00',
  `hours_late` decimal(6,2) DEFAULT '0.00',
  `hours_undertime` decimal(6,2) DEFAULT '0.00',
  `overtime_hours` decimal(6,2) DEFAULT '0.00',
  `basic_pay` decimal(12,2) DEFAULT '0.00',
  `overtime_pay` decimal(12,2) DEFAULT '0.00',
  `holiday_pay` decimal(12,2) DEFAULT '0.00',
  `allowances` decimal(12,2) DEFAULT '0.00',
  `other_earnings` decimal(12,2) DEFAULT '0.00',
  `gross_pay` decimal(12,2) DEFAULT '0.00',
  `sss_deduction` decimal(10,2) DEFAULT '0.00',
  `philhealth_deduction` decimal(10,2) DEFAULT '0.00',
  `pagibig_deduction` decimal(10,2) DEFAULT '0.00',
  `cash_advance_deduction` decimal(12,2) DEFAULT '0.00',
  `other_deductions` decimal(12,2) DEFAULT '0.00',
  `total_deductions` decimal(12,2) DEFAULT '0.00',
  `net_pay` decimal(12,2) DEFAULT '0.00',
  `remarks` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payroll_runs`
--

DROP TABLE IF EXISTS `payroll_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_runs` (
  `id` varchar(36) NOT NULL,
  `cutoff_id` varchar(36) NOT NULL,
  `run_number` varchar(50) DEFAULT NULL,
  `status` enum('Draft','Processing','Finalized') DEFAULT 'Draft',
  `total_employees` int DEFAULT '0',
  `total_gross` decimal(14,2) DEFAULT '0.00',
  `total_deductions` decimal(14,2) DEFAULT '0.00',
  `total_net` decimal(14,2) DEFAULT '0.00',
  `processed_by` varchar(150) DEFAULT NULL,
  `processed_at` datetime DEFAULT NULL,
  `finalized_by` varchar(150) DEFAULT NULL,
  `finalized_at` datetime DEFAULT NULL,
  `notes` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `philhealth_table`
--

DROP TABLE IF EXISTS `philhealth_table`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `philhealth_table` (
  `id` varchar(36) NOT NULL,
  `year` int NOT NULL,
  `rate_percent` decimal(5,2) NOT NULL DEFAULT '5.00',
  `min_monthly_basic` decimal(12,2) NOT NULL DEFAULT '10000.00',
  `max_monthly_basic` decimal(12,2) NOT NULL DEFAULT '100000.00',
  `min_contribution` decimal(10,2) NOT NULL DEFAULT '500.00',
  `max_contribution` decimal(10,2) NOT NULL DEFAULT '5000.00',
  `employee_share_percent` decimal(5,2) NOT NULL DEFAULT '50.00',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `physical_count_items`
--

DROP TABLE IF EXISTS `physical_count_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_count_items` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `physical_count_id` char(36) NOT NULL,
  `product_id` char(36) NOT NULL,
  `qty_system` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_counted` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_variance` decimal(12,3) GENERATED ALWAYS AS ((`qty_counted` - `qty_system`)) STORED,
  `notes` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `physical_count_id` (`physical_count_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `physical_count_items_ibfk_1` FOREIGN KEY (`physical_count_id`) REFERENCES `physical_counts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `physical_count_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `physical_counts`
--

DROP TABLE IF EXISTS `physical_counts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_counts` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `pc_number` varchar(50) NOT NULL,
  `location_id` char(36) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'open',
  `count_date` date NOT NULL DEFAULT (curdate()),
  `notes` text NOT NULL,
  `posted_by` char(36) DEFAULT NULL,
  `posted_at` datetime DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pc_number` (`pc_number`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `physical_counts_ibfk_1` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `physical_counts_chk_1` CHECK ((`status` in (_cp850'open',_cp850'posted',_cp850'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_audit_log`
--

DROP TABLE IF EXISTS `pos_audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_audit_log` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `shift_id` char(36) DEFAULT NULL,
  `terminal_id` char(36) DEFAULT NULL,
  `sale_id` char(36) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `actor_id` char(36) DEFAULT NULL,
  `supervisor_id` char(36) DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_cash_pickup_links`
--

DROP TABLE IF EXISTS `pos_cash_pickup_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_cash_pickup_links` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `pickup_id` char(36) NOT NULL,
  `source_transaction_id` char(36) NOT NULL,
  `source_sale_id` char(36) DEFAULT NULL,
  `linked_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_cash_pickup_links_pickup` (`pickup_id`),
  KEY `idx_pos_cash_pickup_links_txn` (`source_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_cash_pickups`
--

DROP TABLE IF EXISTS `pos_cash_pickups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_cash_pickups` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `shift_id` char(36) NOT NULL,
  `terminal_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `business_date` date NOT NULL,
  `pickup_kind` varchar(30) NOT NULL DEFAULT 'general',
  `pickup_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `reason` varchar(255) NOT NULL DEFAULT '',
  `category` varchar(80) NOT NULL DEFAULT '',
  `related_reference` varchar(120) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `created_by` char(36) DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_cash_pickups_shift` (`shift_id`),
  KEY `idx_pos_cash_pickups_terminal_date` (`terminal_id`,`business_date`),
  KEY `idx_pos_cash_pickups_pickup_at` (`pickup_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_customers`
--

DROP TABLE IF EXISTS `pos_customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_customers` (
  `customer_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `address` text COLLATE utf8mb4_unicode_ci,
  `price_level` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Retail',
  `messenger_psid` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `messenger_linked` tinyint(1) NOT NULL DEFAULT '0',
  `last_messenger_interaction_at` datetime DEFAULT NULL,
  `loyalty_points` int NOT NULL DEFAULT '0',
  `credit_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_message_logs`
--

DROP TABLE IF EXISTS `pos_message_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_message_logs` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `held_sale_id` char(36) NOT NULL,
  `customer_id` char(36) NOT NULL,
  `channel` varchar(30) NOT NULL DEFAULT 'messenger',
  `messenger_psid_used` varchar(255) NOT NULL DEFAULT '',
  `sent_at` datetime DEFAULT NULL,
  `sent_by` char(36) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `error_message` text,
  `meta_message_id` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_message_logs_hold` (`held_sale_id`),
  KEY `idx_pos_message_logs_customer` (`customer_id`),
  KEY `idx_pos_message_logs_channel` (`channel`),
  KEY `idx_pos_message_logs_sent_at` (`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_permissions`
--

DROP TABLE IF EXISTS `pos_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_permissions` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `role` varchar(50) DEFAULT NULL,
  `user_id` char(36) DEFAULT NULL,
  `permission` varchar(50) NOT NULL,
  `max_discount_pct` decimal(5,2) DEFAULT NULL,
  `requires_pin` tinyint(1) NOT NULL DEFAULT '0',
  `pin_hash` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_recent_items`
--

DROP TABLE IF EXISTS `pos_recent_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_recent_items` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `terminal_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `product_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_used_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `use_count` int NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_recent_items_terminal_product` (`terminal_id`,`product_id`),
  KEY `idx_pos_recent_items_terminal_last_used` (`terminal_id`,`last_used_at`),
  KEY `idx_pos_recent_items_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_sequences`
--

DROP TABLE IF EXISTS `pos_sequences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_sequences` (
  `seq_name` varchar(50) NOT NULL,
  `seq_value` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`seq_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_shifts`
--

DROP TABLE IF EXISTS `pos_shifts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_shifts` (
  `shift_id` char(36) NOT NULL DEFAULT (uuid()),
  `terminal_id` char(36) NOT NULL,
  `cashier_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `shift_date` date NOT NULL,
  `business_date` date DEFAULT NULL,
  `status` varchar(10) NOT NULL DEFAULT 'open',
  `opening_cash` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notes` text,
  `expected_cash` decimal(12,2) NOT NULL DEFAULT '0.00',
  `actual_cash` decimal(12,2) NOT NULL DEFAULT '0.00',
  `over_short` decimal(12,2) NOT NULL DEFAULT '0.00',
  `opened_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` datetime DEFAULT NULL,
  `closed_by` char(36) DEFAULT NULL,
  `z_reading_posted_at` datetime DEFAULT NULL,
  `z_reading_posted_by` char(36) DEFAULT NULL,
  `z_reading_reset_at` datetime DEFAULT NULL,
  `z_reading_reset_by` char(36) DEFAULT NULL,
  `z_reading_reset_reason` text,
  PRIMARY KEY (`shift_id`),
  UNIQUE KEY `uq_open_shift` (`cashier_id`,`terminal_id`,`status`,`shift_date`),
  KEY `terminal_id` (`terminal_id`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `pos_shifts_ibfk_1` FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals` (`terminal_id`) ON DELETE RESTRICT,
  CONSTRAINT `pos_shifts_ibfk_2` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `pos_shifts_chk_1` CHECK ((`status` in (_utf8mb4'open',_utf8mb4'closed')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_terminals`
--

DROP TABLE IF EXISTS `pos_terminals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_terminals` (
  `terminal_id` char(36) NOT NULL DEFAULT (uuid()),
  `terminal_code` varchar(20) NOT NULL,
  `terminal_name` varchar(100) NOT NULL,
  `location_id` char(36) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`terminal_id`),
  UNIQUE KEY `terminal_code` (`terminal_code`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `pos_terminals_ibfk_1` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pos_zreading_resets`
--

DROP TABLE IF EXISTS `pos_zreading_resets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pos_zreading_resets` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `shift_id` char(36) NOT NULL,
  `terminal_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `business_date` date NOT NULL,
  `reset_by` char(36) NOT NULL,
  `reason` text NOT NULL,
  `reset_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_zreading_resets_shift` (`shift_id`),
  KEY `idx_pos_zreading_resets_date` (`business_date`),
  KEY `idx_pos_zreading_resets_reset_at` (`reset_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `product_lots`
--

DROP TABLE IF EXISTS `product_lots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_lots` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `product_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `receiving_item_id` char(36) DEFAULT NULL,
  `batch_number` varchar(100) NOT NULL DEFAULT '',
  `expiry_date` date DEFAULT NULL,
  `qty_on_hand` decimal(12,3) NOT NULL DEFAULT '0.000',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  KEY `location_id` (`location_id`),
  KEY `receiving_item_id` (`receiving_item_id`),
  CONSTRAINT `product_lots_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `product_lots_ibfk_2` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `product_lots_ibfk_3` FOREIGN KEY (`receiving_item_id`) REFERENCES `receiving_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `profiles`
--

DROP TABLE IF EXISTS `profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `profiles` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'staff',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `profiles_role_chk` CHECK ((`role` in (_utf8mb4'admin',_utf8mb4'staff',_utf8mb4'cashier')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `purchase_order_items`
--

DROP TABLE IF EXISTS `purchase_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_order_items` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `po_id` char(36) NOT NULL,
  `product_id` char(36) NOT NULL,
  `qty_ordered` decimal(12,3) NOT NULL,
  `qty_received` decimal(12,3) NOT NULL DEFAULT '0.000',
  `unit_cost` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `subtotal` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `notes` text NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `purchase_unit_id` char(36) DEFAULT NULL,
  `purchase_unit_name` varchar(100) NOT NULL DEFAULT '',
  `qty_in_base_unit_per_purchase` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `qty_ordered_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `qty_received_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `cost_per_base_unit` decimal(12,6) NOT NULL DEFAULT '0.000000',
  PRIMARY KEY (`id`),
  KEY `po_id` (`po_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `purchase_order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `purchase_orders`
--

DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `po_number` varchar(50) NOT NULL,
  `supplier_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'draft',
  `order_date` date NOT NULL DEFAULT (curdate()),
  `expected_date` date DEFAULT NULL,
  `notes` text NOT NULL,
  `total_amount` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `approved_by` char(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `po_number` (`po_number`),
  KEY `supplier_id` (`supplier_id`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `purchase_orders_ibfk_2` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `purchase_orders_chk_1` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'submitted',_utf8mb4'approved',_utf8mb4'partially_received',_utf8mb4'fully_received',_utf8mb4'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `receiving_items`
--

DROP TABLE IF EXISTS `receiving_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `receiving_items` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `receiving_id` char(36) NOT NULL,
  `po_item_id` char(36) DEFAULT NULL,
  `product_id` char(36) NOT NULL,
  `qty_received` decimal(12,3) NOT NULL,
  `qty_rejected` decimal(12,3) NOT NULL DEFAULT '0.000',
  `unit_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
  `expiry_date` date DEFAULT NULL,
  `batch_number` varchar(100) NOT NULL DEFAULT '',
  `qty_ordered` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_prev_received` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_remaining` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_accepted` decimal(12,3) NOT NULL DEFAULT '0.000',
  `purchase_unit_id` char(36) DEFAULT NULL,
  `purchase_unit_name` varchar(100) NOT NULL DEFAULT '',
  `qty_in_base_unit_per_purchase` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `qty_received_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `qty_accepted_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `qty_rejected_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `unit_cost_per_base` decimal(12,6) NOT NULL DEFAULT '0.000000',
  PRIMARY KEY (`id`),
  KEY `receiving_id` (`receiving_id`),
  KEY `po_item_id` (`po_item_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `receiving_items_ibfk_2` FOREIGN KEY (`po_item_id`) REFERENCES `purchase_order_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `receiving_items_ibfk_3` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `receivings`
--

DROP TABLE IF EXISTS `receivings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `receivings` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `receiving_number` varchar(50) NOT NULL DEFAULT '',
  `po_id` char(36) NOT NULL,
  `supplier_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `receiving_date` date NOT NULL DEFAULT (curdate()),
  `invoice_number` varchar(100) NOT NULL DEFAULT '',
  `dr_number` varchar(100) NOT NULL DEFAULT '',
  `remarks` text NOT NULL,
  `posted_by` char(36) DEFAULT NULL,
  `posted_at` datetime DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `receiving_number` (`receiving_number`),
  KEY `po_id` (`po_id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `location_id` (`location_id`),
  CONSTRAINT `receivings_ibfk_1` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `receivings_ibfk_3` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `receivings_chk_1` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'posted',_utf8mb4'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `recurring_obligations`
--

DROP TABLE IF EXISTS `recurring_obligations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_obligations` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(150) NOT NULL,
  `category` varchar(80) NOT NULL DEFAULT 'general',
  `default_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `frequency` varchar(20) NOT NULL DEFAULT 'monthly',
  `due_date_rule` varchar(120) NOT NULL DEFAULT '',
  `next_due_date` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `remarks` text,
  `paid_transaction_id` char(36) DEFAULT NULL,
  `paid_disbursement_id` char(36) DEFAULT NULL,
  `last_paid_date` date DEFAULT NULL,
  `last_paid_amount` decimal(12,2) DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sale_items`
--

DROP TABLE IF EXISTS `sale_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_items` (
  `item_id` char(36) NOT NULL DEFAULT (uuid()),
  `sale_id` char(36) NOT NULL,
  `product_id` char(36) DEFAULT NULL,
  `barcode` varchar(100) NOT NULL DEFAULT '',
  `sku_code` varchar(100) NOT NULL DEFAULT '',
  `product_name_snapshot` varchar(255) NOT NULL DEFAULT '',
  `qty` decimal(12,4) NOT NULL,
  `retail_unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `unit_price` decimal(12,2) NOT NULL,
  `wholesale_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `wholesale_break_qty_in_base_unit` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `wholesale_block_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wholesale_blocks_applied` int NOT NULL DEFAULT '0',
  `wholesale_base_qty_applied` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `retail_remainder_base_qty` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `pricing_breakdown` varchar(255) NOT NULL DEFAULT '',
  `selected_price_level` varchar(20) NOT NULL DEFAULT 'Retail',
  `applied_price_level` varchar(20) NOT NULL DEFAULT 'Retail',
  `price_source` varchar(30) NOT NULL DEFAULT 'Retail',
  `cost_at_sale` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sort_order` int NOT NULL DEFAULT '0',
  `selected_unit_id` char(36) DEFAULT NULL,
  `selected_unit_name` varchar(100) NOT NULL DEFAULT '',
  `qty_in_base_unit_per_unit` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `total_base_qty_deducted` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `base_unit_name` varchar(100) NOT NULL DEFAULT '',
  `cost_per_base_unit` decimal(12,6) NOT NULL DEFAULT '0.000000',
  PRIMARY KEY (`item_id`),
  KEY `idx_sale_items_sale` (`sale_id`),
  CONSTRAINT `sale_items_ibfk_1` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`sale_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sale_payments`
--

DROP TABLE IF EXISTS `sale_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_payments` (
  `payment_id` char(36) NOT NULL DEFAULT (uuid()),
  `sale_id` char(36) NOT NULL,
  `payment_method` varchar(20) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reference_no` varchar(100) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`payment_id`),
  KEY `sale_id` (`sale_id`),
  CONSTRAINT `sale_payments_ibfk_1` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`sale_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_sale_payments_method` CHECK ((`payment_method` in (_utf8mb4'cash',_utf8mb4'gcash',_utf8mb4'charge')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sale_return_items`
--

DROP TABLE IF EXISTS `sale_return_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_return_items` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `return_id` char(36) NOT NULL,
  `original_sale_item_id` char(36) NOT NULL,
  `product_id` char(36) DEFAULT NULL,
  `product_name_snapshot` varchar(255) NOT NULL DEFAULT '',
  `sku_code` varchar(100) NOT NULL DEFAULT '',
  `qty_returned` int NOT NULL DEFAULT '0',
  `unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `selected_unit_id` char(36) DEFAULT NULL,
  `selected_unit_name` varchar(100) NOT NULL DEFAULT '',
  `qty_in_base_unit_per_unit` decimal(18,6) NOT NULL DEFAULT '1.000000',
  `total_base_qty_restored` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `base_unit_name` varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sale_returns`
--

DROP TABLE IF EXISTS `sale_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_returns` (
  `return_id` char(36) NOT NULL DEFAULT (uuid()),
  `return_no` varchar(50) NOT NULL DEFAULT '',
  `original_sale_id` char(36) NOT NULL,
  `shift_id` char(36) DEFAULT NULL,
  `terminal_id` char(36) DEFAULT NULL,
  `location_id` char(36) DEFAULT NULL,
  `cashier_id` char(36) DEFAULT NULL,
  `supervisor_id` char(36) DEFAULT NULL,
  `reason` text,
  `refund_method` varchar(50) NOT NULL DEFAULT 'cash',
  `total_return_amt` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`return_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales`
--

DROP TABLE IF EXISTS `sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales` (
  `sale_id` char(36) NOT NULL DEFAULT (uuid()),
  `shift_id` char(36) NOT NULL,
  `terminal_id` char(36) NOT NULL,
  `location_id` char(36) NOT NULL,
  `cashier_id` char(36) NOT NULL,
  `receipt_no` varchar(50) NOT NULL DEFAULT '',
  `sale_status` varchar(20) NOT NULL DEFAULT 'completed',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `amount_tendered` decimal(12,2) NOT NULL DEFAULT '0.00',
  `change_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `customer_id` char(36) DEFAULT NULL,
  `loyalty_points_earned` decimal(12,2) NOT NULL DEFAULT '0.00',
  `loyalty_points_redeemed` decimal(12,2) NOT NULL DEFAULT '0.00',
  `voided_by` char(36) DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `void_reason` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sale_id`),
  UNIQUE KEY `receipt_no` (`receipt_no`),
  KEY `terminal_id` (`terminal_id`),
  KEY `location_id` (`location_id`),
  KEY `idx_sales_shift` (`shift_id`),
  KEY `idx_sales_created` (`created_at`),
  CONSTRAINT `sales_ibfk_1` FOREIGN KEY (`shift_id`) REFERENCES `pos_shifts` (`shift_id`) ON DELETE RESTRICT,
  CONSTRAINT `sales_ibfk_2` FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals` (`terminal_id`) ON DELETE RESTRICT,
  CONSTRAINT `sales_ibfk_3` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `sales_chk_1` CHECK ((`sale_status` in (_utf8mb4'completed',_utf8mb4'held',_utf8mb4'cancelled',_utf8mb4'voided')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sss_table`
--

DROP TABLE IF EXISTS `sss_table`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sss_table` (
  `id` varchar(36) NOT NULL,
  `range_from` decimal(12,2) NOT NULL,
  `range_to` decimal(12,2) NOT NULL,
  `monthly_salary_credit` decimal(12,2) NOT NULL,
  `employee_share` decimal(10,2) NOT NULL,
  `employer_share` decimal(10,2) NOT NULL,
  `total_contribution` decimal(10,2) NOT NULL,
  `effective_year` int NOT NULL DEFAULT '2024',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stock_transfer_items`
--

DROP TABLE IF EXISTS `stock_transfer_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_transfer_items` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `transfer_id` char(36) NOT NULL,
  `product_id` char(36) NOT NULL,
  `qty_requested` decimal(12,3) NOT NULL,
  `qty_issued` decimal(12,3) NOT NULL DEFAULT '0.000',
  `qty_received` decimal(12,3) NOT NULL DEFAULT '0.000',
  `notes` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `transfer_id` (`transfer_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `stock_transfer_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stock_transfers`
--

DROP TABLE IF EXISTS `stock_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_transfers` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `transfer_number` varchar(50) NOT NULL,
  `source_location_id` char(36) NOT NULL,
  `destination_location_id` char(36) NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'draft',
  `transfer_date` date NOT NULL DEFAULT (curdate()),
  `expected_date` date DEFAULT NULL,
  `notes` text NOT NULL,
  `approved_by` char(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `issued_by` char(36) DEFAULT NULL,
  `issued_at` datetime DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transfer_number` (`transfer_number`),
  KEY `source_location_id` (`source_location_id`),
  KEY `destination_location_id` (`destination_location_id`),
  CONSTRAINT `stock_transfers_ibfk_1` FOREIGN KEY (`source_location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `stock_transfers_ibfk_2` FOREIGN KEY (`destination_location_id`) REFERENCES `inv_locations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `stock_transfers_chk_1` CHECK ((`status` in (_cp850'draft',_cp850'approved',_cp850'issued',_cp850'partially_received',_cp850'fully_received',_cp850'cancelled'))),
  CONSTRAINT `stock_transfers_chk_2` CHECK ((`source_location_id` <> `destination_location_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `suppliers`
--

DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `suppliers` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `address` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_person` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `phone` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `city` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `terms` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_state`
--

DROP TABLE IF EXISTS `system_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_state` (
  `setting_key` varchar(255) NOT NULL,
  `value` text NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `transactions`
--

DROP TABLE IF EXISTS `transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transactions` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `account_id` char(36) NOT NULL,
  `transaction_type` varchar(20) NOT NULL,
  `transaction_category` varchar(30) NOT NULL DEFAULT 'regular',
  `cash_in_mode` varchar(20) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `transaction_fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `amount_received` decimal(12,2) DEFAULT NULL,
  `fee_type` varchar(20) NOT NULL DEFAULT 'gcash',
  `delivery_fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cash_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `date` date NOT NULL,
  `description` text NOT NULL,
  `reference_number` varchar(255) NOT NULL DEFAULT '',
  `source` varchar(50) NOT NULL DEFAULT 'gcash',
  `notes` text,
  `cash_source` varchar(50) DEFAULT NULL,
  `cash_out_type` varchar(50) DEFAULT NULL,
  `bank_account_id` char(36) DEFAULT NULL,
  `source_module` varchar(60) DEFAULT NULL,
  `source_reference_id` char(36) DEFAULT NULL,
  `source_sale_id` char(36) DEFAULT NULL,
  `reversal_of_transaction_id` char(36) DEFAULT NULL,
  `disbursement_id` char(36) DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `is_closed` tinyint(1) NOT NULL DEFAULT '0',
  `cleared_at` datetime DEFAULT NULL,
  `source_pos_remittance_id` char(36) DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transactions_account_date` (`account_id`,`date`),
  KEY `idx_transactions_date` (`date`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `transactions_chk_1` CHECK ((`transaction_type` in (_utf8mb4'cash_in',_utf8mb4'cash_out'))),
  CONSTRAINT `transactions_chk_2` CHECK ((`fee_type` in (_utf8mb4'gcash',_utf8mb4'cash'))),
  CONSTRAINT `transactions_chk_3` CHECK ((`source` in (_utf8mb4'gcash',_utf8mb4'cash')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'gcash_pos'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-19 10:28:20
