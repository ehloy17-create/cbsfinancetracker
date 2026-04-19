/*
  # Add Shift Summary Columns to daily_history

  ## Summary
  Adds additional summary columns to `daily_history` to support the new "End Shift"
  feature on the GCash Dashboard. When a shift is closed, all per-account summaries
  including POS Register, Product Payment, and per-shift close timestamps are stored.

  ## Changes to daily_history
  - `total_pos_register` (numeric DEFAULT 0) — total cash from POS register for the shift
  - `total_product_payment` (numeric DEFAULT 0) — total product payments collected
  - `shift_closed_at` (timestamptz) — timestamp when the shift was manually ended
  - `shift_label` (text) — optional label like "Shift 1", "Shift 2" for multi-shift days

  ## Notes
  - All new columns are nullable or have safe defaults, no data loss
  - Existing rows will default to 0 for numeric columns and NULL for timestamps
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_history' AND column_name = 'total_pos_register'
  ) THEN
    ALTER TABLE daily_history ADD COLUMN total_pos_register numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_history' AND column_name = 'total_product_payment'
  ) THEN
    ALTER TABLE daily_history ADD COLUMN total_product_payment numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_history' AND column_name = 'shift_closed_at'
  ) THEN
    ALTER TABLE daily_history ADD COLUMN shift_closed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_history' AND column_name = 'shift_label'
  ) THEN
    ALTER TABLE daily_history ADD COLUMN shift_label text;
  END IF;
END $$;
