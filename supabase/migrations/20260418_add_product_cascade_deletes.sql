-- Update transactions table to cascade on product deletion
ALTER TABLE transactions 
DROP CONSTRAINT IF EXISTS transactions_product_id_fkey;

ALTER TABLE transactions 
ADD CONSTRAINT transactions_product_id_fkey 
FOREIGN KEY (product_id) 
REFERENCES products(id) 
ON DELETE CASCADE;

-- Update inventory_approvals table to cascade on product deletion
ALTER TABLE inventory_approvals 
DROP CONSTRAINT IF EXISTS inventory_approvals_product_id_fkey;

ALTER TABLE inventory_approvals 
ADD CONSTRAINT inventory_approvals_product_id_fkey 
FOREIGN KEY (product_id) 
REFERENCES products(id) 
ON DELETE CASCADE;
