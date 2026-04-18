-- Add metadata columns for store identity
ALTER TABLE stores ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS description TEXT;

-- Update existing stores with placeholders if needed
UPDATE stores SET 
  logo_url = 'https://api.dicebear.com/7.x/identicon/svg?seed=' || name,
  description = 'Tiendita de confianza'
WHERE description IS NULL;
