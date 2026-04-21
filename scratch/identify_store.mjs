import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findStore() {
  const ownerId = '292f5426-e00e-4bb4-84c5-caabc36d6c9a';
  console.log(`Searching for stores for owner ID: ${ownerId}`);
  
  // Try to find the store by name or any mapping
  const { data: stores, error } = await supabase.from('stores').select('*');
  
  if (error) {
    console.error('Error fetching stores:', error);
    return;
  }

  if (stores) {
    console.log(`Found ${stores.length} stores.`);
    const userStore = stores.find(s => s.owner_id === ownerId || s.id === '227e7be1-0963-4fa2-aa75-4e05fba80eac');
    if (userStore) {
      console.log('MATCH FOUND:');
      console.log(JSON.stringify(userStore, null, 2));
    } else {
      console.log('No direct match by owner_id or ID in public list.');
      console.log('Listing all store names for manual check:');
      stores.forEach(s => console.log(`- ${s.name} (${s.id})`));
    }
  }
}

findStore();
