-- Add notes column to transactions for audit comments
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT;
