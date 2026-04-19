/*
  # Fix Profiles RLS - Use Security Definer Function

  The JWT app_metadata approach requires server-side setup to populate role into JWT.
  Instead, use a SECURITY DEFINER function that bypasses RLS when checking the caller's role.
  This breaks the recursion: the function runs as the function owner (bypassing RLS),
  so querying profiles inside it doesn't re-trigger the policy.

  Changes:
  - Create is_admin() helper function with SECURITY DEFINER
  - Drop and recreate admin policies using this function
  - Drop old "Users can view own profile" to consolidate into one SELECT policy
*/

-- Create a security definer function to check admin role (bypasses RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Drop old policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Single SELECT policy: own profile OR admin
CREATE POLICY "Users can view own profile or admins view all"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR is_admin());

-- Single UPDATE policy: own profile OR admin
CREATE POLICY "Users can update own profile or admins update all"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR is_admin())
  WITH CHECK (auth.uid() = id OR is_admin());
