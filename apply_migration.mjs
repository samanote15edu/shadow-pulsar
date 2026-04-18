import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const sql = `
ALTER TABLE transactions 
DROP CONSTRAINT IF EXISTS transactions_product_id_fkey;

ALTER TABLE transactions 
ADD CONSTRAINT transactions_product_id_fkey 
FOREIGN KEY (product_id) 
REFERENCES products(id) 
ON DELETE CASCADE;

ALTER TABLE inventory_approvals 
DROP CONSTRAINT IF EXISTS inventory_approvals_product_id_fkey;

ALTER TABLE inventory_approvals 
ADD CONSTRAINT inventory_approvals_product_id_fkey 
FOREIGN KEY (product_id) 
REFERENCES products(id) 
ON DELETE CASCADE;
`;

// Supabase doesn't have a direct SQL API in the JS client, 
// but we can try to use a RPC or just inform the user.
// Since I can't run arbitrary SQL via the client without a custom function,
// I will try to use the CLI once more with a different syntax.

console.log('SQL to apply:');
console.log(sql);
