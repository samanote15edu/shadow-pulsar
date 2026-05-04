import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function diagnose() {
  console.log("🔍 DIAGNÓSTICO DE INVENTARIO\n");

  // 1. Ver qué productos hay
  const { data: prods } = await supabase.from('products').select('name, store_id').limit(5);
  console.log("📦 Algunos productos en la DB:", prods);

  if (prods && prods.length > 0) {
    const storeId = prods[0].store_id;
    const testName = prods[0].name.substring(0, 4); // Tomar las primeras 4 letras

    console.log(`\n🧪 Probando búsqueda difusa para: "${testName}" en tienda ${storeId}`);
    
    const { data: fuzzy, error } = await supabase.rpc('fuzzy_search_products', {
      search_text: testName,
      store_id_param: storeId,
      similarity_threshold: 0.1 // Muy bajo para forzar resultados
    });

    if (error) console.error("❌ ERROR EN RPC:", error);
    else console.log("✅ RESULTADOS FUZZY:", fuzzy);
  } else {
    console.log("❌ NO HAY PRODUCTOS EN LA DB. El bot no puede encontrar nada.");
  }
}

diagnose();
