/*
  # Add issued_date to checks_issued and bi-directional sync columns

  ## Changes

  1. **checks_issued table**
     - Add `issued_date` column (date the check was actually written/issued, separate from `check_date` which is the date on the face of the check)
     - Add `disbursement_id` column (FK to disbursements, to track if this check was created from a disbursement entry)
     - Backfill `issued_date` = `created_at::date` for existing rows

  2. **disbursements table**
     - `check_id` already exists as FK to checks_issued - no change needed

  ## Notes
  - `issued_date`: the date the check was prepared/issued (defaults to today)
  - `check_date`: the date printed on the check (can be future = PDC, or same/past = outstanding)
  - Same-day check_date (check_date = today) is treated as outstanding
  - When check_date > issued_date it is PDC; when check_date <= today it is outstanding
  - The disbursement_id on checks_issued allows tracing which disbursement created the check
*/

-- Add issued_date to checks_issued
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checks_issued' AND column_name = 'issued_date'
  ) THEN
    ALTER TABLE checks_issued ADD COLUMN issued_date date NOT NULL DEFAULT CURRENT_DATE;
    -- Backfill with created_at date
    UPDATE checks_issued SET issued_date = created_at::date;
  END IF;
END $$;

-- Add disbursement_id to checks_issued so we can trace which disbursement created the check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checks_issued' AND column_name = 'disbursement_id'
  ) THEN
    ALTER TABLE checks_issued ADD COLUMN disbursement_id uuid REFERENCES disbursements(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for disbursement_id
CREATE INDEX IF NOT EXISTS idx_checks_issued_disbursement_id ON checks_issued(disbursement_id);
