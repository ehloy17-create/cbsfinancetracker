/*
  # Fix Profiles SELECT Policy - Guarantee Self-Read Without is_admin() Recursion Risk

  Split the SELECT policy into two separate policies:
  1. Users can always read their own profile (simple auth.uid() = id check, no recursion risk)
  2. Admins can read all profiles (uses is_admin() SECURITY DEFINER function)

  This ensures that every user can reliably load their own profile regardless of
  any potential issues with the is_admin() function evaluation order.
*/

DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON profiles;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_admin());
