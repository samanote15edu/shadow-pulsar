-- Migration: Update invite_codes for role-based onboarding and expiration
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Notify that columns were added
DO $$ BEGIN
    RAISE NOTICE 'Columns metadata and expires_at added to invite_codes';
END $$;
