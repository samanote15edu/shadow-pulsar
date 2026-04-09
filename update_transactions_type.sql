-- Add 'void' to the transaction types
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('sale', 'restock', 'correction', 'fiado_payment', 'void'));

-- Add a column to link voided transactions back to original if we want extreme detail
-- For now, we will just use types.
