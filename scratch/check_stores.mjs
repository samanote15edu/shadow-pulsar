import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .ilike('full_name', '%cesar%');
  
  console.log('Found Profiles:', profiles);

  if (profiles && profiles.length > 0) {
    const userId = profiles[0].id;
    const { data: stores } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', userId);
    
    console.log('Stores for this user:', stores);
  }
}

check();
