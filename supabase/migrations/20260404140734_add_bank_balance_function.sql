/*
  # Add add_bank_balance RPC Function

  ## Summary
  Creates a mirror function to `deduct_bank_balance` that adds an amount back
  to a bank account's current balance. Used when a cleared check is reopened
  or cancelled, reversing the previous deduction.

  ## New Functions
  - `add_bank_balance(p_bank_account_id uuid, p_amount numeric)` — atomically
    increments `current_balance` on the specified bank account and returns the
    new balance. Runs as SECURITY DEFINER to bypass RLS safely.
*/

CREATE OR REPLACE FUNCTION add_bank_balance(
  p_bank_account_id uuid,
  p_amount          numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE bank_accounts
  SET
    current_balance = ROUND((current_balance + p_amount)::numeric, 2),
    updated_at      = now()
  WHERE id = p_bank_account_id
  RETURNING current_balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;
