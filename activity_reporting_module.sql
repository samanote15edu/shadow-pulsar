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

-- Políticas mejoradas
DROP POLICY IF EXISTS "Dueño ve todos los logs" ON activity_logs;
DROP POLICY IF EXISTS "Empleado ve sus propios logs" ON activity_logs;
DROP POLICY IF EXISTS "Empleado ve logs de su tienda" ON activity_logs;
DROP POLICY IF EXISTS "Cualquiera con acceso al log ve evidencias" ON activity_evidences;

-- 1. Reportes: Permitir lectura pública (para Magic Links)
CREATE POLICY "Lectura pública de logs" ON activity_logs FOR SELECT USING (true);

-- 2. Evidencias: Permitir lectura pública
CREATE POLICY "Lectura pública de evidencias" ON activity_evidences FOR SELECT USING (true);

-- 3. Perfiles: Permitir lectura pública de nombres (para el join del dashboard)
DROP POLICY IF EXISTS "Dueño ve perfiles de sus tiendas" ON profiles;
DROP POLICY IF EXISTS "Empleado ve compañeros" ON profiles;
CREATE POLICY "Lectura pública de perfiles" ON profiles FOR SELECT USING (true);

-- 4. FORZAR CONFIGURACIÓN: Asegurar que Don Chingon sea de Reportes
UPDATE stores SET business_type = 'activity_logs' WHERE name ILIKE '%Don Chingon%';

-- 5. Instrucción para Storage:
-- Debes crear un bucket llamado "evidences" en Supabase Storage con acceso público para lectura.
