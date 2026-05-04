-- Tabla para guardar el estado de la conversación de cada usuario
CREATE TABLE IF NOT EXISTS conversation_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_phone TEXT NOT NULL,
    store_id UUID NOT NULL REFERENCES stores(id),
    current_step TEXT,
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_phone, store_id)
);

-- Índice para búsquedas rápidas por teléfono
CREATE INDEX IF NOT EXISTS idx_conv_states_phone ON conversation_states(user_phone);

-- Función para limpiar estados viejos (opcional, para mantener la DB limpia)
-- Podríamos borrar estados que tengan más de 1 hora de antigüedad
