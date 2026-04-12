-- Crear tabla de aprobaciones de inventario
CREATE TABLE IF NOT EXISTS inventory_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  product_id UUID REFERENCES products(id),
  type TEXT NOT NULL, -- 'restock', 'adjustment', 'cost_change', 'price_change', 'new_product'
  quantity NUMERIC,
  old_value NUMERIC,
  new_value NUMERIC,
  requester_name TEXT,
  requester_phone TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  notes TEXT
);

-- Indices para rapidez
CREATE INDEX IF NOT EXISTS idx_approvals_store ON inventory_approvals(store_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON inventory_approvals(status);
