const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'REPLACE_ME'; // No puedo ponerla aquí, la pasaré por ENV

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log("--- BUSCANDO CATARINA ---");
  const { data: stores, error } = await supabase.from('stores').select('*').ilike('name', '%Catarina%');
  
  if (error) console.error("Error:", error);
  if (stores && stores.length > 0) {
    stores.forEach(s => console.log(`ID: ${s.id} | Nombre: ${s.name} | Owner: ${s.owner_id}`));
  } else {
    console.log("No se encontró ninguna tienda con ese nombre.");
    
    console.log("\n--- ÚLTIMAS 5 TIENDAS CREADAS ---");
    const { data: lastStores } = await supabase.from('stores').select('*').order('created_at', { ascending: false }).limit(5);
    lastStores?.forEach(s => console.log(`ID: ${s.id} | Nombre: ${s.name} | Fecha: ${s.created_at}`));
  }
}

check();
