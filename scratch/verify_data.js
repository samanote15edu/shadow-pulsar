import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log("--- REVISANDO TIENDAS ---");
  const { data: stores } = await supabase.from('stores').select('*').order('created_at', { ascending: false }).limit(5);
  stores?.forEach(s => console.log(`[${s.id}] Nombre: ${s.name} | Creada: ${s.created_at}`));

  console.log("\n--- REVISANDO PERFILES ---");
  const { data: profiles } = await supabase.from('profiles').select('whatsapp_number, full_name, store_id').order('created_at', { ascending: false }).limit(5);
  profiles?.forEach(p => console.log(`WhatsApp: ${p.whatsapp_number} | Nombre: ${p.full_name} | Tienda ID: ${p.store_id}`));
}

check();
