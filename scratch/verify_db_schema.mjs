
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = '8ca5ac237eac9e532d1675c8a3075e92723cd67cf8b86da2e8fb43e88fa224fe'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function checkSchema() {
  console.log('Checking database tables...')
  
  const tablesToCheck = [
    'profiles',
    'stores',
    'products',
    'transactions',
    'debug_logs',
    'webhook_idempotency',
    'registration_states',
    'inventory_approvals',
    'fiado_ledgers'
  ]

  for (const table of tablesToCheck) {
    const { error } = await supabase.from(table).select('*').limit(1)
    if (error) {
      console.log(`❌ Table "${table}" error: ${error.message} (Code: ${error.code})`)
    } else {
      console.log(`✅ Table "${table}" exists.`)
    }
  }
}

checkSchema()
