ALTER TABLE products ADD COLUMN IF NOT EXISTS last_cost_price DECIMAL(12, 2) DEFAULT 0.00;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
-- También para las transacciones por si acaso
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
