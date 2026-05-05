import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CommandResponse {
  responseText: string;
  nextStep?: string;
  metadata?: any;
}

export function detectIntent(text: string): any {
  const s = text.toLowerCase().trim();

  // 1. Comandos Administrativos (Prioridad Máxima)
  if (s === 'inventario' || s === 'stock') return { intent: 'GET_INVENTORY' };
  if (s === 'ayuda' || s === 'help' || s === 'comandos' || s === '?') return { intent: 'HELP' };
  if (s === 'link' || s === 'enlace' || s === 'panel') return { intent: 'GET_LINK' };
  if (s === 'cambiar' || s === 'sucursal' || s === 'tienda') return { intent: 'SWITCH_STORE' };
  if (s.includes('nueva tienda') || s.includes('registrar sucursal')) return { intent: 'CREATE_STORE' };
  if (s === 'cierre' || s === 'corte' || s === 'caja') return { intent: 'CASH_CLOSE' };
  if (s.includes('anular') || s.includes('borrar venta')) return { intent: 'VOID_SALE' };
  if (s === 'auditoria' || s === 'revisar stock') return { intent: 'AUDIT_INVENTORY' };

  if (s.includes('vincular')) {
    const storeName = s.replace('vincular', '').trim();
    return { intent: 'LINK_OWNER', storeName };
  }

  // 2. Abonos
  if (s.includes('abono') || s.includes('pago')) {
    const qtyMatch = s.match(/(\d+)/);
    const amount = qtyMatch ? parseFloat(qtyMatch[1]) : 0;
    let customer = s.replace(/abono|pago|a|\d+/g, '').trim();
    if (amount > 0 || customer.length > 0) {
      return { intent: 'PAYMENT_LEDGER', amount, customer };
    }
  }

  // 3. Ventas y Surtidos
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

  const isPositive = (text: string) => {
    const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/gi, '').trim();
    return ['si', 's', 'yes', 'va', 'dale', 'confirmar', 'acepto'].includes(clean);
  };
  const isNegative = (text: string) => {
    const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/gi, '').trim();
    return ['no', 'n', 'cancelar', 'parar', 'reset'].includes(clean);
  };

  // 0. COMANDO GLOBAL: SALIR
  if (isNegative(s) && !currentStep) {
    return {
      responseText: "👋 Entendido. He cancelado el proceso actual. ¿En qué más puedo ayudarte?",
      nextStep: undefined,
      metadata: {}
    };
  }

  // 1. MANEJAR RESPUESTAS A PREGUNTAS (ESTADOS)
  if (currentStep === 'awaiting_similarity_confirmation' || currentStep === 'awaiting_sale_confirmation' || currentStep === 'awaiting_new_store_confirmation') {
    if (isPositive(s)) {
      if (currentStep === 'awaiting_sale_confirmation') {
        return {
          responseText: `🥤 *Venta Confirmada*\nTotal: *$${metadata.total}*\n\n¿Deseas registrar el **pago completo** ahora?`,
          nextStep: 'awaiting_payment_choice',
          metadata: { ...metadata }
        };
      }
      if (currentStep === 'awaiting_new_store_confirmation') {
        return {
          responseText: `✅ Tienda **"${metadata.newStoreName}"** creada con éxito.\n\n¿Te gustaría dar de alta tu primer producto? 📦`,
          nextStep: 'awaiting_first_product_choice',
          metadata: { intent: 'CREATE_NEW_BRANCH', name: metadata.newStoreName }
        };
      }

      // Si no hay suggestedId, es un producto NUEVO que estamos registrando tras un fallo de búsqueda
      if (!metadata.suggestedId) {
        return {
          responseText: `✨ Entendido. Vamos a registrar **"${metadata.newName}"** como producto nuevo.\n\n¿A qué **precio de venta** lo vas a dar?`,
          nextStep: 'awaiting_new_product_price',
          metadata: { newName: metadata.newName, pendingQty: metadata.pendingQty }
        };
      }

      return {
        responseText: `✅ ¡Listo! Registré **${metadata.pendingQty} ${metadata.suggestedName}** en el inventario.`,
        metadata: { intent: 'RESTOCK', productId: metadata.suggestedId, qty: metadata.pendingQty }
      };
    } else if (isNegative(s)) {
      if (currentStep === 'awaiting_first_product_choice') {
        return { responseText: "👍 ¡Entendido! Sabías que puedes registrar productos en el futuro escribiendo *'Surtido'* o simplemente *'Llegaron 5 cocas'*.\n\n¿En qué más te ayudo?" };
      }
      // CANCELACIONES
      if (currentStep === 'awaiting_sale_confirmation' || currentStep === 'awaiting_new_store_confirmation') {
        return { responseText: "❌ Operación cancelada." };
      }
      
      // RESURTIDO -> REGISTRO NUEVO
      return {
        responseText: `✨ Entendido. Vamos a registrar **"${metadata.newName}"** como producto nuevo.\n\n¿A qué **precio de venta** lo vas a dar?`,
        nextStep: 'awaiting_new_product_price',
        metadata: { newName: metadata.newName, pendingQty: metadata.pendingQty }
      };
    }
  }

  // --- FLUJO DE PAGO Y DEUDA ---
  if (currentStep === 'awaiting_payment_choice') {
    if (isPositive(s)) {
      return {
        responseText: `✅ *Pago Completo Registrado.*\n\nVenta cerrada con éxito.`,
        metadata: { intent: 'PROCESS_SALE', ...metadata, amountReceived: metadata.total }
      };
    } else if (isNegative(s)) {
      return {
        responseText: "👤 *Pago Parcial / Fiado*\n\n¿Cuánto **recibiste** en efectivo ahora mismo?",
        nextStep: 'awaiting_paid_amount',
        metadata: { ...metadata }
      };
    }
    return { responseText: "¿Deseas registrar el pago completo? (Responde Sí/No)" };
  }

  if (currentStep === 'awaiting_paid_amount') {
    const received = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(received)) return { responseText: "❌ Envía solo el monto recibido (ej: 10)." };
    
    const debt = metadata.total - received;
    return {
      responseText: `📝 Quedan *$${debt.toFixed(2)}* pendientes.\n\n¿A qué **cliente** le anotamos esta deuda?`,
      nextStep: 'awaiting_debtor_name',
      metadata: { ...metadata, amountReceived: received, debt }
    };
  }

  if (currentStep === 'awaiting_debtor_name') {
    return {
      responseText: `✅ ¡Anotado! Deuda registrada para **${text}**.\n\nVenta finalizada.`,
      metadata: { intent: 'PROCESS_SALE', ...metadata, customerName: text }
    };
  }

  // 1.0 Flujo de Primer Producto
  if (currentStep === 'awaiting_first_product_choice') {
    return {
      responseText: "✍️ ¡Excelente! ¿Cuál es el **nombre** del producto?\n\n_(Ej: Coca Cola 600ml)_",
      nextStep: 'awaiting_first_product_name'
    };
  }

  if (currentStep === 'awaiting_first_product_name') {
    return {
      responseText: `📦 ¿Cuántas unidades de **"${text}"** tienes ahora mismo?`,
      nextStep: 'awaiting_new_product_price', // Saltamos al flujo que ya pide precio/costo
      metadata: { newName: text, pendingQty: 0 } // El usuario enviará el stock ahora
    };
  }

  // Reutilizamos el resto de los flujos de precio/costo
  if (currentStep === 'awaiting_new_product_price') {
    const val = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(val)) return { responseText: "❌ Por favor envía solo el número (ej: 25)." };
    
    // Si no tenemos qty todavía (venimos de el flujo de nombre), este número es la cantidad
    if (metadata.pendingQty === 0) {
      return {
        responseText: `💰 ¡Bien! ¿A qué **precio de venta** lo vas a dar?`,
        nextStep: 'awaiting_new_product_price',
        metadata: { ...metadata, pendingQty: val }
      };
    }

    return {
      responseText: `💰 ¿Y cuánto te **costó** cada unidad?`,
      nextStep: 'awaiting_new_product_cost',
      metadata: { ...metadata, price: val }
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

  if (intentResult.intent === 'HELP') {
    let msg = `🤖 *Asistente Shadow Pulsar*\n\n`;
    msg += `Puedes escribirme de forma natural:\n\n`;
    msg += `🥤 *Ventas:* "Vendí 2 cocas", "2 sabritas", "1 jugo".\n`;
    msg += `📦 *Surtido:* "Llegaron 10 cocas", "Surtido de 5 jugos".\n`;
    msg += `📍 *Sucursales:* "Cambiar" (para moverte de tienda).\n`;
    msg += `📊 *Consultas:* "Inventario", "Link" (panel web).\n`;
    msg += `✨ *Nuevos:* Si un producto no existe, te guiaré para crearlo.\n\n`;
    msg += `Escribe *'Salir'* en cualquier momento para cancelar.`;
    return { responseText: msg };
  }

  // --- FLUJO DE ABONOS ---
  if (intentResult.intent === 'PAYMENT_LEDGER') {
    if (!intentResult.customer) {
      return { responseText: "👤 ¿A qué *cliente* le quieres registrar el abono?" };
    }
    
    const { data: ledger } = await supabase.from('fiado_ledgers').select('*').eq('store_id', storeId).ilike('customer_name', `%${intentResult.customer}%`).maybeSingle();
    
    if (!ledger) {
      return { responseText: `🔍 No encontré al cliente "${intentResult.customer}". Asegúrate de que tenga una deuda registrada.` };
    }

    return {
      responseText: `💰 ¿Confirmas abono de **$${intentResult.amount}** para **${ledger.customer_name}**?\n\nSaldo actual: $${ledger.current_balance}`,
      nextStep: 'awaiting_payment_ledgers_confirmation',
      metadata: { customerId: ledger.id, customerName: ledger.customer_name, amount: intentResult.amount }
    };
  }

  if (currentStep === 'awaiting_payment_ledgers_confirmation') {
    if (isPositive(s)) {
      return {
        responseText: `✅ ¡Abono registrado! Saldo actualizado para **${metadata.customerName}**.`,
        metadata: { intent: 'PROCESS_ABONO', customerId: metadata.customerId, amount: metadata.amount, customerName: metadata.customerName }
      };
    }
    return { responseText: "❌ Abono cancelado." };
  }

  // --- FLUJO DE CIERRE DE CAJA ---
  if (intentResult.intent === 'CASH_CLOSE') {
    return {
      responseText: "💰 *Cierre de Caja Ciego*\n\n¿Cuánto **efectivo físico** tienes ahora mismo en caja?\n\n_(Envía solo el número)_",
      nextStep: 'awaiting_physical_cash'
    };
  }

  if (currentStep === 'awaiting_physical_cash') {
    const physical = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(physical)) return { responseText: "❌ Por favor envía solo el número (ej: 1550)." };

    // Obtener último cierre para calcular lo esperado
    let sinceTimestamp = '1970-01-01T00:00:00Z';
    const { data: lastCorte } = await supabase.from('cash_snapshots').select('closed_at').eq('store_id', storeId).order('closed_at', { ascending: false }).limit(1).maybeSingle();
    if (lastCorte) sinceTimestamp = lastCorte.closed_at;

    const { data: txs } = await supabase.from('transactions').select('amount_received').eq('store_id', storeId).gt('created_at', sinceTimestamp).is('is_voided', false);
    const expected = txs?.reduce((sum, tx) => sum + (Number(tx.amount_received) || 0), 0) || 0;
    const diff = physical - expected;

    let resMsg = `📊 *Resumen de Cierre*\n\n`;
    resMsg += `• Efectivo Real: *$${physical.toFixed(2)}*\n`;
    resMsg += `• Sistema Espera: $${expected.toFixed(2)}\n`;
    resMsg += `---------------------------\n`;
    resMsg += `• Diferencia: *${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}* ${diff === 0 ? '✅' : '⚠️'}\n\n`;
    resMsg += `¿Confirmas el cierre del turno?`;

    return {
      responseText: resMsg,
      nextStep: 'awaiting_corte_confirmation',
      metadata: { physical, expected, diff, since: sinceTimestamp }
    };
  }

  if (currentStep === 'awaiting_corte_confirmation') {
    if (isPositive(s)) {
      return {
        responseText: "✅ *Caja Cerrada*. El registro ha sido guardado.",
        metadata: { intent: 'PROCESS_CORTE', physical: metadata.physical, expected: metadata.expected, since: metadata.since }
      };
    }
    return { responseText: "❌ Corte cancelado." };
  }

  // --- FLUJO DE ANULACIÓN ---
  if (intentResult.intent === 'VOID_SALE') {
    const { data: lastTx } = await supabase.from('transactions').select('*, products(name)').eq('store_id', storeId).eq('type', 'sale').is('is_voided', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
    
    if (!lastTx) return { responseText: "🔍 No encontré ninguna venta reciente para anular." };

    return {
      responseText: `🗑️ ¿Confirmas la **anulación** de la última venta?\n\n• Producto: *${(lastTx as any).products.name}*\n• Cantidad: ${Math.abs(lastTx.quantity_change)}\n• Total: $${lastTx.total_amount}`,
      nextStep: 'awaiting_void_confirmation',
      metadata: { transactionId: lastTx.id, productId: lastTx.product_id, qty: Math.abs(lastTx.quantity_change) }
    };
  }

  if (currentStep === 'awaiting_void_confirmation') {
    if (isPositive(s)) {
      return {
        responseText: "✅ *Venta Anulada*. El stock ha sido devuelto.",
        metadata: { intent: 'PROCESS_VOID', transactionId: metadata.transactionId, productId: metadata.productId, qty: metadata.qty }
      };
    }
    return { responseText: "❌ Anulación cancelada." };
  }

  // --- FLUJO DE AUDITORÍA ---
  if (intentResult.intent === 'AUDIT_INVENTORY') {
    const { data: products } = await supabase.from('products').select('id, name, current_stock').eq('store_id', storeId).order('name', { ascending: true });
    
    if (!products || products.length === 0) return { responseText: "❌ No hay productos registrados para auditar." };

    return {
      responseText: `📝 *Iniciando Auditoría*\n\nTe preguntaré por cada producto. Escribe el número físico que tienes.\n\n1. **${products[0].name}**\n¿Cuántos hay físicamente?`,
      nextStep: 'awaiting_audit_count',
      metadata: { products, currentIndex: 0 }
    };
  }

  if (currentStep === 'awaiting_audit_count') {
    const physical = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(physical)) return { responseText: "❌ Envía solo el número físico (ej: 5)." };

    const { products, currentIndex } = metadata;
    const currentProd = products[currentIndex];
    
    // Guardar el ajuste si hay diferencia
    const diff = physical - currentProd.current_stock;
    if (diff !== 0) {
       await supabase.from('transactions').insert({ 
         store_id: storeId, 
         product_id: currentProd.id, 
         type: 'correction', 
         quantity_change: diff, 
         notes: 'Auditoría WhatsApp' 
       });
       await supabase.rpc('increment_stock', { row_id: currentProd.id, amount: diff });
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < products.length) {
      return {
        responseText: `✅ Guardado. Siguiente:\n\n${nextIndex + 1}. **${products[nextIndex].name}**\n¿Cuántos hay físicamente?`,
        nextStep: 'awaiting_audit_count',
        metadata: { products, currentIndex: nextIndex }
      };
    } else {
      return { responseText: "🏁 *Auditoría Finalizada*. Todos los stocks han sido sincronizados." };
    }
  }

  // --- FLUJO DE VINCULACIÓN ---
  if (intentResult.intent === 'LINK_OWNER') {
    const { data: store } = await supabase.from('stores').select('id, name').ilike('name', `%${intentResult.storeName}%`).maybeSingle();
    if (!store) return { responseText: `🔍 No encontré ninguna tienda que se llame "${intentResult.storeName}".` };
    
    return {
      responseText: `🔗 ¿Confirmas que eres el dueño de **${store.name}** y quieres vincularla a tu panel?`,
      nextStep: 'awaiting_link_confirmation',
      metadata: { storeId: store.id, storeName: store.name }
    };
  }

  if (currentStep === 'awaiting_link_confirmation') {
    if (isPositive(s)) {
      const { data: profile } = await supabase.from('profiles').select('id').eq('whatsapp_number', senderName.replace(/\D/g, '')).maybeSingle();
      if (profile) {
        await supabase.from('stores').update({ owner_id: profile.id }).eq('id', metadata.storeId);
        return { responseText: `✅ ¡Vinculación exitosa! Refresca el panel para ver **${metadata.storeName}**.` };
      }
      return { responseText: "❌ No pude encontrar tu perfil de usuario." };
    }
    return { responseText: "❌ Vinculación cancelada." };
  }

  return { responseText: "" };
}

export async function executeCommand(message: string, supabase: any, storeId: string, role: string, from: string, userId: string) {
    // Fallback minimalista para no romper nada
    return { responseText: "" };
}
