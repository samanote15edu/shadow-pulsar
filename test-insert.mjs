import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testInsert() {
  console.log('--- TESTING INSERT INTO fiado_ledgers ---');
  const testName = 'TEST_DEBUG_' + Date.now();
  
  const { data, error } = await supabase
    .from('fiado_ledgers')
    .insert({
      customer_name: testName,
      store_id: 'c7a01d4e-f9ea-4acb-be26-f987a81eaea7', // Store ID from previous logs
      current_balance: 10
    })
    .select();

  if (error) {
    console.error('Insert Error:', error);
    return;
  }

  console.log('Insert SUCCESS:', JSON.stringify(data, null, 2));
  
  // Now query it back
  const { data: list } = await supabase.from('fiado_ledgers').select('*');
  console.log('Current table content size:', list.length);
}

testInsert();
