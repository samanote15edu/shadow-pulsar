-- Add Unit of Measure column to products
ALTER TABLE products ADD COLUMN unit_of_measure TEXT DEFAULT 'pza';

-- Update existing transactions to reflect that units are pza by default if needed 
-- (mostly for reporting purposes later)
