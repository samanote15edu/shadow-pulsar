-- 1. Encontrar el ID del perfil del dueño (tu número)
DO $$
DECLARE
    v_profile_id UUID;
    v_store_id UUID;
BEGIN
    SELECT id INTO v_profile_id FROM profiles WHERE whatsapp_number = '5215513531114' LIMIT 1;
    
    -- 2. Encontrar la tienda "La Catarina" que no tiene dueño
    SELECT id INTO v_store_id FROM stores WHERE name ILIKE '%Catarina%' AND owner_id IS NULL LIMIT 1;
    
    -- 3. Si encontramos ambos, vincularlos
    IF v_profile_id IS NOT NULL AND v_store_id IS NOT NULL THEN
        UPDATE stores SET owner_id = v_profile_id WHERE id = v_store_id;
        RAISE NOTICE 'Tienda La Catarina vinculada al perfil %', v_profile_id;
    ELSE
        RAISE NOTICE 'No se pudo vincular. Perfil: %, Tienda: %', v_profile_id, v_store_id;
    END IF;
END $$;
