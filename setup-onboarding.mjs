import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'redacted_key';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const sql = `
-- Invite Codes (To control access)
CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Registration States (State machine for WhatsApp onboarding)
CREATE TABLE IF NOT EXISTS registration_states (
    whatsapp_number TEXT PRIMARY KEY,
    step TEXT NOT NULL CHECK (step IN ('awaiting_invite_code', 'awaiting_store_name')),
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert a default test code
INSERT INTO invite_codes (code, max_uses) VALUES ('TIENDITA2026', 10) ON CONFLICT DO NOTHING;
`;

async function setup() {
  console.log("Executing SQL...");
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) {
    // If RPC isn't available, we'll try a different way
    console.log("RPC exec_sql failed, trying direct query (if allowed)...");
    console.error(error);
  } else {
    console.log("Success!");
  }
}

setup();
