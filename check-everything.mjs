import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkEverything() {
  console.log('--- BUSCANDO TRANSACCIONES RECIENTES ---');
  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log(JSON.stringify(txs, null, 2));

  console.log('\n--- BUSCANDO REGISTROS EN FIADO_LEDGERS ---');
  const { data: ledgers } = await supabase
    .from('fiado_ledgers')
    .select('*');
  console.log(JSON.stringify(ledgers, null, 2));
}

checkEverything();
