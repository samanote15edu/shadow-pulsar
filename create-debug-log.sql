-- Create a table to catch incoming webhook data for debugging. No icons used.
CREATE TABLE IF NOT EXISTS debug_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  payload jsonb
);

-- Give the anon user permission to insert into it (Edge Functions use service role, but just in case)
ALTER TABLE debug_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable insert for all" ON debug_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for all" ON debug_logs FOR SELECT USING (true);
