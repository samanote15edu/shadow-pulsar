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
