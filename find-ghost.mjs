import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findGhost() {
  const targetId = '720654e8-7382-4f5f-8630-d0dee5421de4';
  console.log(`Searching for ID: ${targetId}`);
  
  const tables = ['fiado_ledgers', 'profiles', 'stores', 'products', 'registration_states'];
  
  for (const table of tables) {
    try {
      const { data } = await supabase.from(table).select('*').eq('id', targetId);
      if (data && data.length > 0) {
        console.log(`MATCH FOUND in table: ${table}`);
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    } catch (e) {
      // Skip errors
    }
  }
  console.log('No match found in standard tables.');
}

findGhost();
