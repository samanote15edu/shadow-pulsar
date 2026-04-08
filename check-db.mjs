import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log("Checking profiles and states...");
  
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
  console.log("Profiles in DB:", profiles?.length || 0);
  if (profiles) profiles.forEach(p => console.log(`- ${p.whatsapp_number}: ${p.full_name}`));

  const { data: states, error: sErr } = await supabase.from('registration_states').select('*');
  console.log("States in DB:", states?.length || 0);
  if (states) states.forEach(s => console.log(`- ${s.whatsapp_number}: ${s.step}`));
}

check();
