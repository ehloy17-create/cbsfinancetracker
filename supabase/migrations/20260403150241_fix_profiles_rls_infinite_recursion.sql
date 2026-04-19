/*
  # Fix Profiles RLS Infinite Recursion

  The "Admins can view/update all profiles" policies were causing infinite recursion
  because they queried the profiles table to check if the current user is an admin,
  which in turn triggered the same SELECT policy again.

  Fix: Replace the subquery on profiles with auth.jwt() to read the role from the
  JWT claims, breaking the recursion cycle.

  Changes:
  - Drop the recursive admin SELECT and UPDATE policies on profiles
  - Recreate them using auth.jwt() -> 'user_metadata' ->> 'role' check
  - Also add a combined SELECT policy so admins can see all profiles
*/

-- Drop the old recursive policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- Admins can view ALL profiles (using JWT to avoid recursion)
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    (auth.uid() = id)
    OR
    (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  );

-- Admins can update all profiles (using JWT to avoid recursion)
CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = id)
    OR
    (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  )
  WITH CHECK (
    (auth.uid() = id)
    OR
    (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  );
