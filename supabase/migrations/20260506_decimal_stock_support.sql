-- 1. Eliminamos temporalmente la vista que bloquea el cambio
DROP VIEW IF EXISTS stock_integrity_audit CASCADE;

-- 2. Cambiamos las columnas a tipo NUMERIC para aceptar decimales
ALTER TABLE products ALTER COLUMN current_stock TYPE NUMERIC;
ALTER TABLE transactions ALTER COLUMN quantity_change TYPE NUMERIC;

-- 3. Borramos la versión vieja de la función (que solo aceptaba INTEGER)
DROP FUNCTION IF EXISTS increment_stock(uuid, integer);

-- 4. Actualizamos la función de suma para que acepte decimales (NUMERIC)
CREATE OR REPLACE FUNCTION increment_stock(row_id UUID, amount NUMERIC)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET current_stock = current_stock + amount
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
