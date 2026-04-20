import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testJoin() {
  const from = '5215512345678'; // Use a phone number that exists if possible
  const { data, error } = await supabase
    .from('profiles')
    .select('*, stores(name, business_type)')
    .limit(1)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Profile Data Structure:');
  console.log(JSON.stringify(data, null, 2));
}

testJoin();
