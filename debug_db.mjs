import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkProfiles() {
  console.log('--- Revisando Perfiles y Tiendas ---');
  const { data: profiles, error: pError } = await supabase.from('profiles').select('whatsapp_number, role, store_id').order('created_at', { ascending: false }).limit(5);
  
  if (pError) console.error('Error perfiles:', pError);
  else console.table(profiles);

  const { data: stores, error: sError } = await supabase.from('stores').select('id, name').limit(5);
  if (sError) console.error('Error tiendas:', sError);
  else console.table(stores);
}

checkProfiles();
