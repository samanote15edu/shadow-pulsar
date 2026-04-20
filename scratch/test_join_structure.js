const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testJoin() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, stores(name, business_type)')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Profile Data Structure:');
  console.log(JSON.stringify(data[0], null, 2));
}

testJoin();
