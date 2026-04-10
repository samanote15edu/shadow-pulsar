import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function inspectSchema() {
  console.log('--- INSPECTING ALL TABLES ---');
  // We'll try to guess table names based on common patterns
  const likelyTables = ['fiado_ledgers', 'fiado_ledger', 'customers', 'fiados', 'transactions', 'products', 'stores'];
  
  for (const table of likelyTables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`Table [${table}]: Not Found or Error`);
    } else {
      console.log(`Table [${table}]: EXISTS with ${count} records.`);
      
      if (count > 0) {
        const { data } = await supabase.from(table).select('*').limit(1);
        console.log(`Sample row from [${table}]:`, JSON.stringify(data[0], null, 2));
      }
    }
  }
}

inspectSchema();
