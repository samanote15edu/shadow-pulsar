import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://yrjjajjmhirwkgldulzl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU'
);

async function fix() {
  const cesarId = 'cc04e6ce-7abf-4926-a3aa-f15166422e32';
  
  const { data, error } = await supabase
    .from('stores')
    .update({ owner_id: cesarId })
    .eq('name', 'Don Chingon');
  
  if (error) {
    console.error('Error linking store:', error);
  } else {
    console.log('Success! Don Chingon is now linked to Cesar.');
    
    // Also verify profile store_id setup
    const { data: updatedProfile } = await supabase
      .from('profiles')
      .update({ role: 'owner' }) // Ensure he is owner
      .eq('id', cesarId)
      .select();
    
    console.log('Profile verification:', updatedProfile);
  }
}

fix();
