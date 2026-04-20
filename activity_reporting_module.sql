-- 1. Expandir Tiendas para soportar tipos de negocio
ALTER TABLE stores ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'inventory' CHECK (business_type IN ('inventory', 'activity_logs'));

-- 2. Tabla de Bitácora de Actividades
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    performer_id UUID REFERENCES profiles(id), -- Quién reportó
    description TEXT NOT NULL,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabla de Evidencias (Fotos)
CREATE TABLE IF NOT EXISTS activity_evidences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_log_id UUID REFERENCES activity_logs(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    media_id_whatsapp TEXT, -- ID de Meta para referencia
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Habilitar RLS (Seguridad)
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_evidences ENABLE ROW LEVEL SECURITY;

-- Políticas básicas (Dueño ve todo, Empleado ve lo suyo)
-- Eliminamos políticas anteriores si existen para evitar errores
DROP POLICY IF EXISTS "Dueño ve todos los logs" ON activity_logs;
DROP POLICY IF EXISTS "Empleado ve sus propios logs" ON activity_logs;
DROP POLICY IF EXISTS "Cualquiera con acceso al log ve evidencias" ON activity_evidences;

CREATE POLICY "Dueño ve todos los logs" ON activity_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner' AND store_id = activity_logs.store_id)
);

CREATE POLICY "Empleado ve sus propios logs" ON activity_logs FOR SELECT USING (
    performer_id = auth.uid()
);

CREATE POLICY "Cualquiera con acceso al log ve evidencias" ON activity_evidences FOR SELECT USING (
    EXISTS (SELECT 1 FROM activity_logs WHERE id = activity_evidences.activity_log_id)
);

-- 5. Instrucción para Storage:
-- Debes crear un bucket llamado "evidences" en Supabase Storage con acceso público para lectura.
