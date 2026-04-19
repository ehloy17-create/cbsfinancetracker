/*
  # Fix is_admin() function to use SECURITY DEFINER

  ## Problem
  The is_admin() function queries the profiles table, but the profiles table has
  an RLS policy ("Admins can read all profiles") that itself calls is_admin(),
  causing infinite recursion whenever is_admin() is evaluated in any policy
  (e.g., updating accounts triggers is_admin() -> queries profiles -> triggers
  the profiles RLS policy -> calls is_admin() again).

  ## Fix
  Recreate is_admin() as SECURITY DEFINER so it runs with the privileges of the
  function owner (bypassing RLS on profiles), breaking the recursive loop.
*/

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
