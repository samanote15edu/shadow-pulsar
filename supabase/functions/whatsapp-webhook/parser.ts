import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CommandResponse {
  responseText: string;
  nextStep?: string;
  metadata?: any;
}

export function detectIntent(text: string): any {
  const s = text.toLowerCase().trim();
  const restockKeywords = ['llegaron', 'llego', 'llegó', 'trajeron', 'trajo', 'resurtir', 'recibi', 'recibí', 'surtido', 'entrada'];
  const saleKeywords = ['vendi', 'vendí', 'vender', 'venta', 'sale', 'dame', 'ponme', 'despacha'];
  
  const isRestock = restockKeywords.some(k => s.includes(k));
  const isSale = saleKeywords.some(k => s.includes(k)) || /^\d+/.test(s);
  
  const qtyMatch = s.match(/(\d+)/);
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

  if (isRestock) {
    let product = s;
    restockKeywords.forEach(k => product = product.replace(k, ''));
    product = product.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    return { intent: 'RESTOCK', qty, product };
  }

  if (isSale) {
    let product = s;
    saleKeywords.forEach(k => product = product.replace(k, ''));
    product = product.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    return { intent: 'SALE', qty, product };
  }

  // Comandos Administrativos
  if (s === 'cambiar' || s === 'sucursal' || s === 'tienda') return { intent: 'SWITCH_STORE' };
  if (s.includes('nueva tienda') || s.includes('registrar sucursal')) return { intent: 'CREATE_STORE' };
  if (s === 'link' || s === 'enlace' || s === 'panel') return { intent: 'GET_LINK' };
  if (s === 'inventario' || s === 'stock') return { intent: 'GET_INVENTORY' };

  return { intent: 'UNKNOWN' };
}

export async function handleCommand(
  text: string, 
  storeId: string, 
  supabase: SupabaseClient,
  senderName: string,
  convState: any
): Promise<CommandResponse> {
  const s = text.toLowerCase().trim();
  const currentStep = convState?.step;
  const metadata = convState?.metadata || {};

  console.log(`[DEBUG] handleCommand: "${s}" | Step: ${currentStep}`);

  // 0. COMANDO GLOBAL: SALIR
  if (['salir', 'cancelar', 'reset', 'parar'].includes(s)) {
    return {
      responseText: "👋 Entendido. He cancelado el proceso actual. ¿En qué más puedo ayudarte?",
      nextStep: undefined, // Esto disparará el borrado del estado en index.ts
      metadata: {}
    };
  }

  // 1. MANEJAR RESPUESTAS A PREGUNTAS (ESTADOS)
  if (currentStep === 'awaiting_similarity_confirmation' || currentStep === 'awaiting_sale_confirmation') {
    const isPositive = ['si', 'sí', 's', 'yes', 'va', 'dale'].includes(s);
    if (isPositive) {
      if (currentStep === 'awaiting_sale_confirmation') {
        return {
          responseText: `✅ Venta registrada de **${metadata.qty} ${metadata.productName}**. Total: $${metadata.total}`,
          metadata: { intent: 'SALE', productId: metadata.productId, qty: metadata.qty, total: metadata.total }
        };
      }
      return {
        responseText: `✅ ¡Listo! Registré **${metadata.pendingQty} ${metadata.suggestedName}** en el inventario.`,
        metadata: { intent: 'RESTOCK', productId: metadata.suggestedId, qty: metadata.pendingQty }
      };
    } else {
      return {
        responseText: `✨ Entendido. Vamos a registrar **"${metadata.newName}"** como producto nuevo.\n\n¿A qué **precio de venta** lo vas a dar?`,
        nextStep: 'awaiting_new_product_price',
        metadata: { newName: metadata.newName, pendingQty: metadata.pendingQty }
      };
    }
  }

  // 1.1 Capturar Precio de Venta (Nuevo Producto)
  if (currentStep === 'awaiting_new_product_price') {
    const price = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(price)) {
      return { responseText: "❌ Por favor envía solo el número del precio (ej: 25)." };
    }
    return {
      responseText: `💰 ¡Bien! ¿Y cuánto te **costó** cada unidad?`,
      nextStep: 'awaiting_new_product_cost',
      metadata: { ...metadata, price }
    };
  }

  // 1.2 Capturar Costo y Finalizar (Nuevo Producto)
  if (currentStep === 'awaiting_new_product_cost') {
    const cost = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(cost)) return { responseText: "❌ Por favor envía solo el número del costo (ej: 18)." };
    return {
      responseText: `✅ *¡Producto Registrado!* ✨\n\nNombre: ${metadata.newName}\nStock inicial: +${metadata.pendingQty}\nPrecio: $${metadata.price}\nCosto: $${cost}`,
      metadata: { intent: 'CREATE_PRODUCT', name: metadata.newName, price: metadata.price, cost: cost, qty: metadata.pendingQty }
    };
  }

  // 1.3 Cambiar de Tienda
  if (currentStep === 'awaiting_store_switch') {
    const { data: stores } = await supabase.from('stores').select('id, name').ilike('name', `%${s}%`);
    if (stores && stores.length > 0) {
      return {
        responseText: `📍 Sucursal cambiada a **${stores[0].name}**.`,
        metadata: { intent: 'UPDATE_PROFILE_STORE', storeId: stores[0].id }
      };
    }
    return { responseText: "❌ No encontré esa tienda. Escribe el nombre exacto o 'Salir'." };
  }

  // 1.4 Crear Nueva Tienda
  if (currentStep === 'awaiting_new_store_name') {
    return {
      responseText: `✨ ¿Confirmas la creación de la tienda **"${text}"**?`,
      nextStep: 'awaiting_new_store_confirmation',
      metadata: { newStoreName: text }
    };
  }

  if (currentStep === 'awaiting_new_store_confirmation') {
    if (['si', 'sí', 's', 'yes'].includes(s)) {
      return {
        responseText: `✅ Tienda **"${metadata.newStoreName}"** creada con éxito.`,
        metadata: { intent: 'CREATE_NEW_BRANCH', name: metadata.newStoreName }
      };
    }
    return { responseText: "Cancelado.", metadata: {} };
  }

  // 2. DETECTAR NUEVA INTENCIÓN
  const intentResult = detectIntent(text);
  console.log(`[DEBUG] Intent: ${intentResult.intent} | Product: "${intentResult.product}"`);

  // --- FLUJO DE RESURTIDO (RESTOCK) ---
  if (intentResult.intent === 'RESTOCK' && intentResult.product) {
    let searchTerm = intentResult.product;
    if (searchTerm.endsWith('s') && searchTerm.length > 3) searchTerm = searchTerm.slice(0, -1);

    // 1. Búsqueda Difusa (Trigramas)
    const { data: fuzzy } = await supabase.rpc('fuzzy_search_products', {
      search_text: searchTerm,
      store_id_param: storeId,
      similarity_threshold: 0.15
    });

    let bestMatch = fuzzy && fuzzy.length > 0 ? fuzzy[0] : null;

    // 2. Fallback: Búsqueda ILIKE
    if (!bestMatch || bestMatch.similarity < 0.3) {
      const { data: ilikeProds } = await supabase.from('products').select('id, name').eq('store_id', storeId).eq('is_active', true).ilike('name', `%${searchTerm}%`).limit(1);
      if (ilikeProds && ilikeProds.length > 0) bestMatch = { ...ilikeProds[0], similarity: 0.5 };
    }

    if (bestMatch && bestMatch.similarity > 0.4) {
      return {
        responseText: `📦 ¿Confirmas resurtido de **${intentResult.qty} ${bestMatch.name}**?`,
        nextStep: 'awaiting_similarity_confirmation',
        metadata: { suggestedId: bestMatch.id, suggestedName: bestMatch.name, pendingQty: intentResult.qty, newName: intentResult.product }
      };
    }

    return {
      responseText: `🔍 No encontré "${intentResult.product}" en tu inventario.\n\n¿Quieres registrarlo como **producto nuevo**?`,
      nextStep: 'awaiting_similarity_confirmation',
      metadata: { newName: intentResult.product, pendingQty: intentResult.qty, isNew: true }
    };
  }

  // --- FLUJO DE VENTA (SALE) ---
  if (intentResult.intent === 'SALE' && intentResult.product) {
    let searchTerm = intentResult.product;
    if (searchTerm.endsWith('s') && searchTerm.length > 3) searchTerm = searchTerm.slice(0, -1);

    // Búsqueda
    const { data: fuzzy } = await supabase.rpc('fuzzy_search_products', {
      search_text: searchTerm,
      store_id_param: storeId,
      similarity_threshold: 0.15
    });

    let bestMatch = fuzzy && fuzzy.length > 0 ? fuzzy[0] : null;
    if (!bestMatch) {
      const { data: ilikeProds } = await supabase.from('products').select('id, name, base_price').eq('store_id', storeId).eq('is_active', true).ilike('name', `%${searchTerm}%`).limit(1);
      if (ilikeProds && ilikeProds.length > 0) bestMatch = { ...ilikeProds[0], similarity: 0.5 };
    }

    if (bestMatch && bestMatch.similarity > 0.3) {
      const total = intentResult.qty * (bestMatch.base_price || 0);
      return {
        responseText: `🥤 ¿Confirmas venta de **${intentResult.qty} ${bestMatch.name}**?\n\nTOTAL: *$${total}*`,
        nextStep: 'awaiting_sale_confirmation',
        metadata: { 
          productId: bestMatch.id, 
          productName: bestMatch.name, 
          newName: intentResult.product, // Guardamos el nombre original por si acaso
          qty: intentResult.qty, 
          price: bestMatch.base_price, 
          total 
        }
      };
    }

    return { responseText: `🔍 No encontré el producto "${intentResult.product}" para venderlo.` };
  }

  // --- COMANDOS ADMINISTRATIVOS ---
  if (intentResult.intent === 'SWITCH_STORE') {
    const { data: stores } = await supabase.from('stores').select('id, name').eq('owner_id', (await supabase.from('profiles').select('id').eq('store_id', storeId).maybeSingle()).data?.id);
    if (!stores || stores.length <= 1) return { responseText: "📍 Solo tienes una tienda registrada." };
    
    return {
      responseText: "📍 *Cambiar de Sucursal*\n\nEscribe el nombre de la tienda a la que quieres cambiar:\n\n" + stores.map(s => `• ${s.name}`).join('\n'),
      nextStep: 'awaiting_store_switch'
    };
  }

  if (intentResult.intent === 'GET_LINK') {
    const { data: user } = await supabase.from('profiles').select('id').eq('store_id', storeId).maybeSingle();
    return { responseText: `🔗 *Tu Panel de Control:*\n\nhttps://shadow-pulsar.vercel.app/?s=${storeId}&u=${user?.id}` };
  }

  if (intentResult.intent === 'CREATE_STORE') {
    return {
      responseText: "✨ *Nueva Sucursal*\n\n¿Cómo se llamará la nueva tienda?",
      nextStep: 'awaiting_new_store_name'
    };
  }

  if (intentResult.intent === 'GET_INVENTORY') {
    const { data: prods } = await supabase.from('products').select('name, current_stock').eq('store_id', storeId).eq('is_active', true).order('current_stock', { ascending: true }).limit(10);
    if (!prods) return { responseText: "📭 Tu inventario está vacío." };
    const list = prods.map(p => `${p.current_stock <= 0 ? '❌' : '📦'} ${p.name}: *${p.current_stock}*`).join('\n');
    return { responseText: `📊 *Inventario Actual (Top 10):*\n\n${list}\n\nEscribe 'Inventario' para ver todo en el panel.` };
  }

  return { responseText: "" };
}

export async function executeCommand(message: string, supabase: any, storeId: string, role: string, from: string, userId: string) {
    // Fallback minimalista para no romper nada
    return { responseText: "" };
}
