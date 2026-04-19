
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function fetchLogs() {
  console.log('Fetching latest debug logs...')
  const { data, error } = await supabase
    .from('debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)
    
  if (error) {
    console.log(`❌ Error: ${error.message}`)
  } else {
    console.log('Latest Logs:', JSON.stringify(data, null, 2))
  }
}

fetchLogs()
