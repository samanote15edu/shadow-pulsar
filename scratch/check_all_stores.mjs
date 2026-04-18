import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://yrjjajjmhirwkgldulzl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU'
);

async function check() {
  const { data: stores, error } = await supabase
    .from('stores')
    .select('*');
  
  if (error) {
    console.error('Error fetching stores:', error);
    return;
  }
  
  console.log('--- ALL STORES IN DB ---');
  stores.forEach(s => {
    console.log(`ID: ${s.id} | Name: ${s.name} | Owner: ${s.owner_id}`);
  });
}

check();
