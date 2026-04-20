-- Enable pgcrypto for UUIDs if not default
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Stores (One owner can have many)
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id),
    name TEXT NOT NULL,
    address TEXT,
    timezone TEXT DEFAULT 'America/Mexico_City',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Profiles (Connecting WhatsApp numbers to roles)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    whatsapp_number TEXT UNIQUE,
    full_name TEXT,
    role TEXT DEFAULT 'employee' CHECK (role IN ('owner', 'employee')),
    store_id UUID REFERENCES stores(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Products (with Variants as JSONB for simplicity in 'Tienditas' context)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    barcode TEXT, -- Optional, can be NULL for loose items
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    base_price DECIMAL(12, 2) DEFAULT 0.00,
    current_stock INTEGER DEFAULT 0,
    min_stock_alert INTEGER DEFAULT 5,
    variants JSONB DEFAULT '[]'::jsonb, -- [{ "name": "Large", "price_adj": 5, "stock": 10 }]
    last_restock_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(store_id, barcode) -- Ensure barcode uniqueness within a single store
);

-- Transactions (Stock changes, sales, cortes)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    performer_id UUID REFERENCES auth.users(id), -- Who did the update?
    product_id UUID REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('sale', 'restock', 'correction', 'fiado_payment')),
    quantity_change INTEGER NOT NULL,
    unit_price DECIMAL(12, 2),
    total_amount DECIMAL(12, 2),
    source TEXT DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'pwa')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fiado (Credit records)
CREATE TABLE fiado_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    customer_name TEXT NOT NULL,
    customer_whatsapp TEXT,
    current_balance DECIMAL(12, 2) DEFAULT 0.00,
    notes TEXT,
    last_update_at TIMESTAMPTZ DEFAULT now()
);

-- Corte de Caja snapshots
CREATE TABLE cash_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    started_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ DEFAULT now(),
    expected_cash DECIMAL(12, 2) NOT NULL,
    actual_cash DECIMAL(12, 2) NOT NULL,
    discrepancy DECIMAL(12, 2) GENERATED ALWAYS AS (actual_cash - expected_cash) STORED,
    status TEXT DEFAULT 'closed'
);
-- Invite Codes (To control access)
CREATE TABLE invite_codes (
    code TEXT PRIMARY KEY,
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Registration States (State machine for WhatsApp onboarding)
CREATE TABLE registration_states (
    whatsapp_number TEXT PRIMARY KEY,
    step TEXT NOT NULL CHECK (step IN ('awaiting_invite_code', 'awaiting_store_name')),
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert a default test code
INSERT INTO invite_codes (code, max_uses) VALUES ('TIENDITA2026', 10) ON CONFLICT DO NOTHING;

-- ==========================================
-- ACTIVITY REPORTING MODULE (EXTENSION)
-- ==========================================

-- 1. Expand Stores for business types
ALTER TABLE stores ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'inventory' CHECK (business_type IN ('inventory', 'activity_logs'));

-- 2. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    performer_id UUID REFERENCES profiles(id),
    description TEXT NOT NULL,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Activity Evidences Table (Photos)
CREATE TABLE IF NOT EXISTS activity_evidences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_log_id UUID REFERENCES activity_logs(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    media_id_whatsapp TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. RLS for Activity Reporting
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_evidences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dueño ve todos los logs" ON activity_logs;
DROP POLICY IF EXISTS "Empleado ve logs de su tienda" ON activity_logs;
DROP POLICY IF EXISTS "Acceso a evidencias" ON activity_evidences;

-- Owner can see everything in their own stores
CREATE POLICY "Dueño ve todos los logs" ON activity_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM stores WHERE id = activity_logs.store_id AND owner_id = auth.uid())
);

-- Employees can see logs from their own store
CREATE POLICY "Empleado ve logs de su tienda" ON activity_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND store_id = activity_logs.store_id)
);

-- Evidences linked to accessible logs are visible
CREATE POLICY "Acceso a evidencias" ON activity_evidences FOR SELECT USING (
    EXISTS (SELECT 1 FROM activity_logs WHERE id = activity_evidences.activity_log_id)
);

-- Crucial: Ensure profiles are readable for joins (names)
DROP POLICY IF EXISTS "Ver nombres de la tienda" ON profiles;
CREATE POLICY "Ver nombres de la tienda" ON profiles FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.store_id = profiles.store_id)
);
