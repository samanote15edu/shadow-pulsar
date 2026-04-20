import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkActivities() {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*, activity_evidences(*)');

  if (error) {
    console.error('Error fetching activities:', error);
    return;
  }

  console.log('Activities in DB (Service Role):', data.length);
  if (data.length > 0) {
    console.log('First Activity:', JSON.stringify(data[0], null, 2));
  }
}

checkActivities();
