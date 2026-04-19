
/*
  # Consolidate Bank Accounts

  ## Summary
  The user only has one real bank account (Chinabank / China Bank Savings).
  A duplicate account "Cebu Baking Supply Bakery Products Wholesaling" was created
  with a beginning balance of 96,055 but has no transactions linked to it.
  All real transactions (deposits, check payments) are on "China Bank Savings".

  ## Changes
  1. Set the correct beginning_balance on "China Bank Savings" to 64,356.20
     so that current_balance = beginning(64356.20) + deposits(62000) - payments(63322.75) = 63,033.45
  2. Recalculate and set current_balance to 63,033.45 on "China Bank Savings"
  3. Make "China Bank Savings" the active account (is_active = true)
  4. Deactivate the duplicate "Cebu Baking Supply" account (is_active = false)
*/

-- Fix China Bank Savings: set correct beginning balance and activate it
UPDATE bank_accounts
SET
  beginning_balance = 64356.20,
  current_balance   = 63033.45,
  is_active         = true,
  updated_at        = now()
WHERE id = '6a01b145-d850-414d-8067-1fee93a73f76';

-- Deactivate the duplicate account (no transactions linked to it)
UPDATE bank_accounts
SET
  is_active  = false,
  updated_at = now()
WHERE id = '00a8ebdf-1519-4c29-96d8-bf72c91260a1';
