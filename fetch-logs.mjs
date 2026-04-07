import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkLogs() {
  console.log('Checking debug_logs table... (No icons used)');
  const { data, error } = await supabase
    .from('debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching logs:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No logs found. Meta is not hitting our server.');
  } else {
    data.forEach((log, index) => {
      console.log(`Log #${index + 1} at ${log.created_at}:`);
      console.log(JSON.stringify(log.payload, null, 2));
    });
  }
}

checkLogs();
