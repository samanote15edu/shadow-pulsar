-- 1. Habilitar la extensión de trigramas si no está habilitada
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Crear una función de búsqueda difusa para productos
CREATE OR REPLACE FUNCTION fuzzy_search_products(search_text TEXT, store_id_param UUID, similarity_threshold FLOAT DEFAULT 0.3)
RETURNS TABLE (
    id UUID,
    name TEXT,
    price DECIMAL,
    stock DECIMAL,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id, 
        p.name, 
        p.price, 
        p.stock,
        similarity(p.name, search_text) as sim
    FROM products p
    WHERE p.store_id = store_id_param
      AND similarity(p.name, search_text) > similarity_threshold
    ORDER BY sim DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;
