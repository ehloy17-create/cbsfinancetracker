/*
  # Fix Security and Performance Issues

  ## Summary
  Addresses all flagged issues from the Supabase security advisor:

  1. Unindexed Foreign Keys
     - Adds covering indexes for all foreign key columns missing them across:
       bank_deposits, cash_transactions, checks_issued, daily_history,
       daily_sales, disbursements, suppliers

  2. Auth RLS Initialization Plan
     - Rewrites all RLS policies that call auth.<function>() directly so they
       use (select auth.<function>()) instead, preventing per-row re-evaluation
     - Affected tables: profiles, accounts, suppliers, checks_issued,
       disbursements, transactions, daily_history, bank_deposits, system_state,
       audit_logs, cash_transactions, bank_accounts, daily_sales

  3. Unused Indexes
     - Drops all indexes flagged as unused to reduce write overhead and bloat

  4. is_admin Function Search Path
     - Sets search_path = '' on public.is_admin to prevent search path injection
*/

-- ============================================================
-- 1. ADD MISSING FK INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_bank_deposits_created_by
  ON public.bank_deposits (created_by);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_created_by
  ON public.cash_transactions (created_by);

CREATE INDEX IF NOT EXISTS idx_checks_issued_bank_account_id
  ON public.checks_issued (bank_account_id);

CREATE INDEX IF NOT EXISTS idx_checks_issued_created_by
  ON public.checks_issued (created_by);

CREATE INDEX IF NOT EXISTS idx_daily_history_posted_by
  ON public.daily_history (posted_by);

CREATE INDEX IF NOT EXISTS idx_daily_sales_created_by
  ON public.daily_sales (created_by);

CREATE INDEX IF NOT EXISTS idx_disbursements_created_by
  ON public.disbursements (created_by);

CREATE INDEX IF NOT EXISTS idx_disbursements_supplier_id
  ON public.disbursements (supplier_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_created_by
  ON public.suppliers (created_by);

-- ============================================================
-- 2. DROP UNUSED INDEXES
-- ============================================================

DROP INDEX IF EXISTS public.idx_disbursements_payment_method;
DROP INDEX IF EXISTS public.idx_disbursements_check_id;
DROP INDEX IF EXISTS public.idx_transactions_date;
DROP INDEX IF EXISTS public.idx_transactions_created_by;
DROP INDEX IF EXISTS public.idx_transactions_is_deleted;
DROP INDEX IF EXISTS public.idx_daily_history_account_id;
DROP INDEX IF EXISTS public.idx_audit_logs_timestamp;
DROP INDEX IF EXISTS public.idx_audit_logs_user_id;
DROP INDEX IF EXISTS public.idx_cash_transactions_type;
DROP INDEX IF EXISTS public.idx_bank_deposits_bank_account_id;
DROP INDEX IF EXISTS public.idx_bank_deposits_date;
DROP INDEX IF EXISTS public.idx_checks_issued_supplier_id;
DROP INDEX IF EXISTS public.idx_daily_sales_date;
DROP INDEX IF EXISTS public.idx_daily_sales_is_deleted;

-- ============================================================
-- 3. FIX is_admin FUNCTION SEARCH PATH
-- ============================================================

ALTER FUNCTION public.is_admin() SET search_path = '';

-- ============================================================
-- 4. FIX RLS POLICIES — wrap auth.<fn>() with (select ...)
-- ============================================================

-- ---- profiles ----
DROP POLICY IF EXISTS "Allow insert during signup" ON public.profiles;
CREATE POLICY "Allow insert during signup"
  ON public.profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON public.profiles;
CREATE POLICY "Users can view own profile or admins view all"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = id
    OR (select public.is_admin())
  );

DROP POLICY IF EXISTS "Users can update own profile or admins update all" ON public.profiles;
CREATE POLICY "Users can update own profile or admins update all"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = id
    OR (select public.is_admin())
  )
  WITH CHECK (
    (select auth.uid()) = id
    OR (select public.is_admin())
  );

-- ---- accounts ----
DROP POLICY IF EXISTS "Admins can insert accounts" ON public.accounts;
CREATE POLICY "Admins can insert accounts"
  ON public.accounts FOR INSERT
  TO authenticated
  WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "Admins can update accounts" ON public.accounts;
CREATE POLICY "Admins can update accounts"
  ON public.accounts FOR UPDATE
  TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- ---- suppliers ----
DROP POLICY IF EXISTS "Authenticated users can insert suppliers" ON public.suppliers;
CREATE POLICY "Authenticated users can insert suppliers"
  ON public.suppliers FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update suppliers" ON public.suppliers;
CREATE POLICY "Authenticated users can update suppliers"
  ON public.suppliers FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete suppliers" ON public.suppliers;
CREATE POLICY "Authenticated users can delete suppliers"
  ON public.suppliers FOR DELETE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

-- ---- checks_issued ----
DROP POLICY IF EXISTS "Authenticated users can insert checks issued" ON public.checks_issued;
CREATE POLICY "Authenticated users can insert checks issued"
  ON public.checks_issued FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update checks issued" ON public.checks_issued;
CREATE POLICY "Authenticated users can update checks issued"
  ON public.checks_issued FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete checks issued" ON public.checks_issued;
CREATE POLICY "Authenticated users can delete checks issued"
  ON public.checks_issued FOR DELETE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

-- ---- disbursements ----
DROP POLICY IF EXISTS "Authenticated users can insert disbursements" ON public.disbursements;
CREATE POLICY "Authenticated users can insert disbursements"
  ON public.disbursements FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update disbursements" ON public.disbursements;
CREATE POLICY "Authenticated users can update disbursements"
  ON public.disbursements FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete disbursements" ON public.disbursements;
CREATE POLICY "Authenticated users can delete disbursements"
  ON public.disbursements FOR DELETE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

-- ---- transactions ----
DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON public.transactions;
CREATE POLICY "Authenticated users can insert transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Admins and owners can update transactions" ON public.transactions;
CREATE POLICY "Admins and owners can update transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = created_by
    OR (select public.is_admin())
  )
  WITH CHECK (
    (select auth.uid()) = created_by
    OR (select public.is_admin())
  );

DROP POLICY IF EXISTS "Admins can delete transactions" ON public.transactions;
CREATE POLICY "Admins can delete transactions"
  ON public.transactions FOR DELETE
  TO authenticated
  USING ((select public.is_admin()));

-- ---- daily_history ----
DROP POLICY IF EXISTS "System can insert daily history" ON public.daily_history;
CREATE POLICY "System can insert daily history"
  ON public.daily_history FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Admins can update daily history" ON public.daily_history;
CREATE POLICY "Admins can update daily history"
  ON public.daily_history FOR UPDATE
  TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- ---- bank_deposits ----
DROP POLICY IF EXISTS "Authenticated users can insert bank deposits" ON public.bank_deposits;
CREATE POLICY "Authenticated users can insert bank deposits"
  ON public.bank_deposits FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update bank deposits" ON public.bank_deposits;
CREATE POLICY "Authenticated users can update bank deposits"
  ON public.bank_deposits FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ---- system_state ----
DROP POLICY IF EXISTS "Admins can modify system state" ON public.system_state;
CREATE POLICY "Admins can modify system state"
  ON public.system_state FOR INSERT
  TO authenticated
  WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "Admins can update system state" ON public.system_state;
CREATE POLICY "Admins can update system state"
  ON public.system_state FOR UPDATE
  TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- ---- audit_logs ----
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
CREATE POLICY "System can insert audit logs"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ---- cash_transactions ----
DROP POLICY IF EXISTS "Authenticated users can insert cash transactions" ON public.cash_transactions;
CREATE POLICY "Authenticated users can insert cash transactions"
  ON public.cash_transactions FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ---- bank_accounts ----
DROP POLICY IF EXISTS "Authenticated users can insert bank accounts" ON public.bank_accounts;
CREATE POLICY "Authenticated users can insert bank accounts"
  ON public.bank_accounts FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update bank accounts" ON public.bank_accounts;
CREATE POLICY "Authenticated users can update bank accounts"
  ON public.bank_accounts FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ---- daily_sales ----
DROP POLICY IF EXISTS "Authenticated users can insert daily sales" ON public.daily_sales;
CREATE POLICY "Authenticated users can insert daily sales"
  ON public.daily_sales FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update daily sales" ON public.daily_sales;
CREATE POLICY "Authenticated users can update daily sales"
  ON public.daily_sales FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL)
  WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete daily sales" ON public.daily_sales;
CREATE POLICY "Authenticated users can delete daily sales"
  ON public.daily_sales FOR DELETE
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL);
