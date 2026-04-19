/*
  # Add atomic bank balance deduction function

  ## Summary
  Creates a security-definer RPC function that atomically deducts an amount
  from a bank account's current_balance. This prevents race conditions from
  client-side read-then-write patterns.

  ## New Functions
  - `deduct_bank_balance(p_bank_account_id uuid, p_amount numeric)` 
    - Atomically deducts p_amount from the bank account's current_balance
    - Returns the new balance
    - Runs as SECURITY DEFINER to bypass RLS safely
*/

CREATE OR REPLACE FUNCTION deduct_bank_balance(
  p_bank_account_id uuid,
  p_amount numeric
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
    current_balance = ROUND((current_balance - p_amount)::numeric, 2),
    updated_at = now()
  WHERE id = p_bank_account_id
  RETURNING current_balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$;
