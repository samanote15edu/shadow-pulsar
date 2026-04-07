import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkUser() {
  console.log('Checking profiles for whatsapp_number... (No icons used)');
  const { data, error } = await supabase
    .from('profiles')
    .select('whatsapp_number, store_id')
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Stored profiles:', JSON.stringify(data, null, 2));
}

checkUser();
