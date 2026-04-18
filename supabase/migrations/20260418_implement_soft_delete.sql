-- 1. Add is_active column
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Handle unique constraint for barcodes (allow same barcode if previous products are inactive)
-- First, find the constraint name. Usually it's products_store_id_barcode_key
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_store_id_barcode_key;

-- 3. Create a partial unique index that only applies to active products
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_products_barcode 
ON products (store_id, barcode) 
WHERE (is_active = true);
