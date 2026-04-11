import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Carga manual de variables desde .env.local
const env = fs.readFileSync('.env.local', 'utf8');
const config = Object.fromEntries(env.split('\n').map(line => line.split('=')));

const supabase = createClient(
  config.VITE_SUPABASE_URL.trim(),
  config.VITE_SUPABASE_ANON_KEY.trim()
);

async function checkProfiles() {
  console.log('--- REVISIÓN DE SEGURIDAD DE PERFILES ---');
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('whatsapp_number, role, store_id')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.table(profiles);
  }
}

checkProfiles();
