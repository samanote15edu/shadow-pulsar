-- Migration: Add is_voided to activity_logs
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT FALSE;
