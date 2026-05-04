import { handleCommand } from './supabase/functions/whatsapp-webhook/parser.ts';

// Mock simple de Supabase
const mockSupabase: any = {
  rpc: async (name: string, params: any) => {
    console.log(`\n🔍 [DB] Buscando: "${params.search_text}"...`);
    // Simulamos que encontramos algo si el texto contiene "coca" o "sabrita"
    if (params.search_text.includes('coca')) {
      return { data: [{ id: '1', name: 'Coca Cola 600ml', similarity: 0.85 }], error: null };
    }
    if (params.search_text.includes('sabrita')) {
      return { data: [{ id: '2', name: 'Sabritas Original 45g', similarity: 0.90 }], error: null };
    }
    return { data: [], error: null };
  }
};

async function runTests() {
  const cases = [
    "Me llegaron 20 cocas",
    "Llegaron 10 sabritas",
    "hola",
    "vendi 1 coca"
  ];

  console.log("==========================================");
  console.log("   TESTING ROBUST PARSER V2 (INTENTS)    ");
  console.log("==========================================\n");

  for (const text of cases) {
    console.log(`📩 USUARIO: "${text}"`);
    const res = await handleCommand(text, 'store_abc', mockSupabase, 'Saman');
    console.log(`🤖 BOT: ${res.responseText}`);
    if (res.nextStep) console.log(`👉 STEP: ${res.nextStep}`);
    console.log("------------------------------------------\n");
  }
}

runTests();
