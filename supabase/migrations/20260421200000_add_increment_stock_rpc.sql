CREATE OR REPLACE FUNCTION increment_stock(row_id UUID, amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET current_stock = current_stock + amount
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
