-- Add is_voided column to track which transactions have been reversed
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT false;
