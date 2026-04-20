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

-- 1. Dueño: Ve todo lo de sus tiendas (Independiente de su perfil activo)
CREATE POLICY "Dueño ve todos los logs" ON activity_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM stores WHERE id = activity_logs.store_id AND owner_id = auth.uid())
);

-- 2. Empleado: Ve los logs de su propia tienda
CREATE POLICY "Empleado ve logs de su tienda" ON activity_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND store_id = activity_logs.store_id)
);

-- 3. Evidencias: Si puedes ver el log, puedes ver la evidencia
CREATE POLICY "Acceso a evidencias" ON activity_evidences FOR SELECT USING (
    EXISTS (SELECT 1 FROM activity_logs WHERE id = activity_evidences.activity_log_id)
);

-- 4. Perfiles: PERMISO CRÍTICAMENTE MEJORADO
-- Permite que el dueño vea TODOS los perfiles de sus tiendas (necesario para ver nombres en el dashboard)
DROP POLICY IF EXISTS "Ver nombres de la tienda" ON profiles;
CREATE POLICY "Dueño ve perfiles de sus tiendas" ON profiles FOR SELECT USING (
    EXISTS (SELECT 1 FROM stores WHERE id = profiles.store_id AND owner_id = auth.uid())
);

-- Permite que los empleados vean nombres de sus compañeros
CREATE POLICY "Empleado ve compañeros" ON profiles FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.store_id = profiles.store_id)
);

-- 5. FORZAR TIPO DE NEGOCIO (Asegurar que Don Chingon sea de Reportes)
UPDATE stores SET business_type = 'activity_logs' WHERE name ILIKE '%Don Chingon%';

-- 5. Instrucción para Storage:
-- Debes crear un bucket llamado "evidences" en Supabase Storage con acceso público para lectura.
