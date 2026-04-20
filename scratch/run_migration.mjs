import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { 
    sql: 'ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT FALSE;' 
  });
  if (error) console.error('Error:', error);
  else console.log('Success:', data);
}

run();
