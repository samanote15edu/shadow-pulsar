import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const userId = 'cc04e6ce-7abf-4926-a3aa-f15166422e32';
  
  const { data: stores } = await supabase
    .from('stores')
    .select('*')
    .eq('owner_id', userId);
  
  console.log('Stores owned by Cesar:', stores);

  const { data: profile } = await supabase
    .from('profiles')
    .select('store_id')
    .eq('id', userId)
    .single();
  
  console.log('Profile store_id points to:', profile?.store_id);
}

check();
