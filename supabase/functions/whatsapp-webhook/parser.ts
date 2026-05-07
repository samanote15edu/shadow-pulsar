import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Templates } from './templates.ts';

export interface CommandResponse {
  responseText: string;
  nextStep?: string;
  metadata?: any;
}

export function detectIntent(text: string): any {
  let s = text.toLowerCase().trim();

  // 0. Limpieza Quirúrgica de Relleno (Naturalidad)
  const fillers = ['oye', 'porfa', 'por favor', 'anotame', 'anota', 'registra', 'apunta', 'apuntame', 'pon', 'ponme', 'agrega', 'agregame', 'puse', 'metele', 'mete'];
  fillers.forEach(f => {
    s = s.replace(new RegExp(`^${f}\\b\\s*`, 'gi'), ''); // Al inicio
    s = s.replace(new RegExp(`\\s*${f}\\b`, 'gi'), '');   // En medio o final
  });

  // Manejo de Fracciones Naturales
  s = s.replace(/\bmedio\b/g, '0.5');
  s = s.replace(/\bcuarto\b/g, '0.25');

  // 1. Comandos Administrativos
  if (['hola', 'hi', 'buenas', 'buenos dias', 'buenas tardes', 'buen dia', 'buenas noches', 'hello'].includes(s)) return { intent: 'GREETING' };
  if (s === 'inventario' || s === 'stock') return { intent: 'GET_INVENTORY' };
  if (['agregar', 'nuevo', 'agregar producto', 'nuevo producto', 'añadir', 'surtir', 'surtido'].includes(s)) return { intent: 'ADD_PRODUCT' };
  if (s === 'ayuda' || s === 'help' || s === 'comandos' || s === '?') return { intent: 'HELP' };
  if (s === 'link' || s === 'enlace' || s === 'panel') return { intent: 'GET_LINK' };
  if (s === 'cambiar' || s === 'sucursal' || s === 'tienda') return { intent: 'SWITCH_STORE' };
  if (s.includes('nueva tienda') || s.includes('registrar sucursal')) return { intent: 'CREATE_STORE' };
  if (s === 'cierre' || s === 'corte' || s === 'caja') return { intent: 'CASH_CLOSE' };
  if (s.includes('anular') || s.includes('borrar venta')) return { intent: 'VOID_SALE' };
  if (s === 'auditoria' || s === 'revisar stock') return { intent: 'AUDIT_INVENTORY' };
  if (['editar', 'deshacer', 'corregir', 'cambiar ultimo'].includes(s)) return { intent: 'EDIT_LAST' };

  if (s.startsWith('vincular')) {
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
  const restockKeywords = ['llegaron', 'llego', 'llegó', 'trajeron', 'trajo', 'resurtir', 'recibi', 'recibí', 'surtido', 'surtir', 'entrada', 'agrega', 'agregar', 'añadir', 'añade', 'meter', 'mete'];
  const saleKeywords = ['vendi', 'vendí', 'vender', 'venta', 'sale', 'dame', 'ponme', 'despacha', 'compraron', 'llevaron', 'se llevaron', 'llevo', 'llevó', 'salio', 'salieron', 'fie', 'fiale', 'fiame', 'fiaron', 'deben', 'deve', 'dever', 'debe', 'deber', 'fiao'];
  
  const isRestock = restockKeywords.some(k => s.includes(k));
  const isSale = saleKeywords.some(k => s.includes(k)) || /^\d+/.test(s);
  
  if (isRestock) {
    const qtyMatch = s.match(/(\d+(\.\d+)?)/);
    const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
    let product = s;
    restockKeywords.forEach(k => product = product.replace(new RegExp(`\\b${k}\\b`, 'gi'), ''));
    product = product.replace(/(\d+(\.\d+)?)/g, '').replace(/\s+/g, ' ').trim();
    product = product.replace(/^(?:(?:kilos|kilo|kg|gramos|gramo|gr|litros|litro|lt|paquetes|paquete|cajas|caja|piezas|pieza|pzas|pza|de)\b\s*)+/gi, '').trim();
    return { intent: 'RESTOCK', qty, product };
  }

  if (isSale) {
    let cleanS = s;
    saleKeywords.forEach(k => cleanS = cleanS.replace(new RegExp(`\\b${k}\\b`, 'gi'), ''));
    cleanS = cleanS.replace(/,|\s+y\s+|\s+con\s+/gi, ' ').trim();
    const segments = cleanS.split(/(?:^|\s)(?=\d+(?:\.\d+)?\s+)/).filter(Boolean);
    const creditKeywords = ['fiado', 'fiada', 'fiados', 'fiadas', 'fie', 'fiamos', 'fiale', 'fiame', 'fiaron', 'deben', 'debe', 'deber', 'deve', 'dever', 'llebaron', 'llevaron', 'fiao'];
    const isCredit = creditKeywords.some(k => s.includes(k));

    const items = segments.map(seg => {
       const qtyMatch = seg.match(/^(\d+(\.\d+)?)/);
       const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
       let product = seg.replace(/^(\d+(\.\d+)?)/, '').trim();
       
       // Limpiar unidades
       product = product.replace(/^(?:(?:kilos|kilo|kg|gramos|gramo|gr|litros|litro|lt|paquetes|paquete|cajas|caja|piezas|pieza|pzas|pza|de)\b\s*)+/gi, '').trim();
       
       // Limpiar palabras de crédito del nombre del producto (Naturalidad)
       creditKeywords.forEach(k => {
         product = product.replace(new RegExp(`\\b${k}\\b`, 'gi'), '').trim();
       });

       return { qty, product };
    }).filter(i => i.product.length > 0);

    if (items.length > 0) return { intent: 'MULTI_SALE', items, isCredit };
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

  const isPositive = (text: string) => {
    const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/gi, '').trim();
    return ['si', 's', 'yes', 'va', 'dale', 'confirmar', 'acepto', 'so', 'sip', 'simon', 'sobres', 'ok', 'okay', 'arree'].includes(clean);
  };
  const isNegative = (text: string) => {
    const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/gi, '').trim();
    return ['no', 'n', 'cancelar', 'parar', 'reset', 'nel', 'nop', 'never', 'not', 'ni madres', 'nones', 'fiado', 'debe', 'deve', 'fio'].includes(clean);
  };

  // --- PRIORIDAD 1: COMANDOS VIP (Vía Rápida) ---
  const intentResult = detectIntent(text);
  
  if (intentResult.intent === 'HELP') return { responseText: Templates.Global.help };
  if (intentResult.intent === 'GREETING') return { responseText: Templates.Global.greeting };
  if (intentResult.intent === 'EDIT_LAST' && storeId) {
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: lastProd } = await supabase.from('products').select('*').eq('store_id', storeId).gt('created_at', tenMinsAgo).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lastProd) {
      return {
        responseText: Templates.Admin.editLastPrompt(lastProd.name),
        nextStep: 'awaiting_edit_selection',
        metadata: { editProdId: lastProd.id, editProdName: lastProd.name }
      };
    }
  }

  // --- PRIORIDAD 2: MANEJAR ESTADOS ---
  
  // 1.1 Onboarding e Invitación
  if (!storeId && !currentStep) return { responseText: Templates.Onboarding.welcomeInvite, nextStep: 'awaiting_invite_code' };

  if (currentStep === 'awaiting_invite_code') {
    const { data: code } = await supabase.from('invite_codes').select('*').eq('code', text.trim().toUpperCase()).eq('is_active', true).maybeSingle();
    if (code && code.current_uses < code.max_uses) {
      return { responseText: Templates.Onboarding.askOwnerName, nextStep: 'awaiting_owner_name', metadata: { inviteCode: code.code } };
    }
    return { responseText: Templates.Onboarding.invalidInvite, nextStep: 'awaiting_invite_code' };
  }

  if (currentStep === 'awaiting_owner_name') {
    const ownerName = text.trim();
    if (ownerName.length < 3) return { responseText: "⚠️ Por favor ingresa tu nombre completo." };
    return { responseText: Templates.Onboarding.askStoreName(ownerName), nextStep: 'awaiting_new_store_name', metadata: { ...metadata, ownerName } };
  }

  if (currentStep === 'awaiting_new_store_name') {
    return { responseText: Templates.Onboarding.newStoreConfirmation(text), nextStep: 'awaiting_new_store_confirmation', metadata: { newStoreName: text } };
  }

  // 1.2 Confirmaciones Generales
  if (currentStep === 'awaiting_similarity_confirmation' || currentStep === 'awaiting_sale_confirmation' || currentStep === 'awaiting_new_store_confirmation' || currentStep === 'awaiting_debtor_name_direct') {
    if (isPositive(s)) {
      if (currentStep === 'awaiting_sale_confirmation') return { responseText: Templates.Sales.saleConfirmedPaymentChoice(metadata.total), nextStep: 'awaiting_payment_choice', metadata };
      if (currentStep === 'awaiting_debtor_name_direct') return { responseText: Templates.Sales.debtRemainingPrompt(metadata.total), nextStep: 'awaiting_debtor_name', metadata: { ...metadata, amountReceived: 0, debt: metadata.total } };
      if (currentStep === 'awaiting_new_store_confirmation') return { responseText: Templates.Onboarding.storeCreatedProcessing(metadata.newStoreName), nextStep: 'awaiting_first_product_choice', metadata: { intent: 'CREATE_NEW_BRANCH', name: metadata.newStoreName } };
      
      if (!metadata.suggestedId) {
        return { responseText: Templates.Onboarding.firstProductUnitPrompt, nextStep: 'awaiting_product_unit', metadata: { newName: metadata.newName, pendingQty: metadata.pendingQty === 1 ? 0 : metadata.pendingQty } };
      }
      return { responseText: Templates.Inventory.restockSuccess(metadata.pendingQty, metadata.suggestedName), metadata: { intent: 'RESTOCK', productId: metadata.suggestedId, qty: metadata.pendingQty } };
    } else if (isNegative(s)) {
      return { responseText: Templates.Global.cancelOperation };
    }
  }

  // 1.3 Flujo de Pago y Deuda
  if (currentStep === 'awaiting_payment_choice') {
    if (isPositive(s)) return { responseText: Templates.Sales.fullPaymentSuccess, metadata: { intent: 'PROCESS_SALE', ...metadata, amountReceived: metadata.total } };
    else if (isNegative(s)) return { responseText: Templates.Sales.partialPaymentPrompt, nextStep: 'awaiting_paid_amount', metadata };
    return { responseText: Templates.Sales.requireYesNoForFullPayment };
  }

  if (currentStep === 'awaiting_paid_amount') {
    const received = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(received)) return { responseText: Templates.Global.invalidNumberAmount };
    const debt = metadata.total - received;
    return { responseText: Templates.Sales.debtRemainingPrompt(debt), nextStep: 'awaiting_debtor_name', metadata: { ...metadata, amountReceived: received, debt } };
  }

  if (currentStep === 'awaiting_debtor_name') {
    return { responseText: Templates.Sales.debtRegisteredSuccess(text), metadata: { intent: 'PROCESS_SALE', ...metadata, customerName: text } };
  }

  // 1.4 Creación de Producto
  if (currentStep === 'awaiting_first_product_choice') {
    if (isNegative(s)) return { responseText: Templates.Onboarding.firstProductDecline };
    return { responseText: Templates.Onboarding.firstProductPrompt, nextStep: 'awaiting_first_product_name' };
  }

  if (currentStep === 'awaiting_first_product_name') {
    return { responseText: Templates.Onboarding.firstProductUnitPrompt, nextStep: 'awaiting_product_unit', metadata: { newName: text, pendingQty: 0 } };
  }

  if (currentStep === 'awaiting_product_unit') {
    let unit = 'pza'; let unitDisplay = 'unidades';
    if (s.includes('kilo') || s.includes('kg')) { unit = 'kg'; unitDisplay = 'Kilogramos (kg)'; }
    else if (s.includes('gramo') || s.includes('gr')) { unit = 'gr'; unitDisplay = 'Gramos (gr)'; }
    else if (s.includes('litro') || s.includes('lt')) { unit = 'lt'; unitDisplay = 'Litros (lt)'; }
    else if (s.includes('caja')) { unit = 'caja'; unitDisplay = 'Cajas'; }
    else if (s.includes('paquete')) { unit = 'paquete'; unitDisplay = 'Paquetes'; }

    if (metadata.pendingQty > 0) return { responseText: Templates.Onboarding.newProductPricePrompt, nextStep: 'awaiting_new_product_price', metadata: { ...metadata, unit } };
    return { responseText: Templates.Onboarding.firstProductQtyPrompt(metadata.newName, unitDisplay), nextStep: 'awaiting_new_product_price', metadata: { ...metadata, pendingQty: 0, unit } };
  }

  if (currentStep === 'awaiting_new_product_price') {
    const val = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(val)) return { responseText: Templates.Global.invalidNumber };
    if (metadata.pendingQty === 0) return { responseText: Templates.Onboarding.newProductPricePrompt, nextStep: 'awaiting_new_product_price', metadata: { ...metadata, pendingQty: val } };
    return { responseText: Templates.Onboarding.newProductCostPrompt, nextStep: 'awaiting_new_product_cost', metadata: { ...metadata, price: val } };
  }

  if (currentStep === 'awaiting_new_product_cost') {
    const cost = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(cost)) return { responseText: Templates.Global.invalidNumber };
    return { responseText: Templates.Onboarding.productRegisteredSuccess(metadata.newName, metadata.pendingQty, metadata.price, cost), nextStep: 'awaiting_post_creation_action', metadata: { intent: 'CREATE_PRODUCT', name: metadata.newName, price: metadata.price, cost: cost, qty: metadata.pendingQty, unit: metadata.unit || 'pza' } };
  }

  if (currentStep === 'awaiting_post_creation_action') {
    if (s.includes('inventario')) intentResult.intent = 'GET_INVENTORY';
    else if (s.match(/\bventa\b/)) intentResult.intent = 'GREETING'; // Reset
    else if (s.includes('agregar')) intentResult.intent = 'ADD_PRODUCT';
    else if (s.includes('editar')) intentResult.intent = 'EDIT_LAST';
    else return { responseText: Templates.Global.unrecognized };
  }

  // 1.5 Otros Estados Administrativos
  if (currentStep === 'awaiting_store_switch') {
    const { data: stores } = await supabase.from('stores').select('id, name').ilike('name', `%${s}%`);
    if (stores && stores.length > 0) return { responseText: Templates.Admin.storeSwitchedSuccess(stores[0].name), metadata: { intent: 'UPDATE_PROFILE_STORE', storeId: stores[0].id } };
    return { responseText: Templates.Admin.switchStoreNotFound };
  }

  if (currentStep === 'awaiting_link_confirmation') {
    if (isPositive(s)) {
      const { data: profile } = await supabase.from('profiles').select('id').eq('whatsapp_number', senderName.replace(/\D/g, '')).maybeSingle();
      if (profile) { await supabase.from('stores').update({ owner_id: profile.id }).eq('id', metadata.storeId); return { responseText: Templates.Admin.linkStoreSuccess(metadata.storeName) }; }
      return { responseText: Templates.Admin.linkStoreProfileNotFound };
    }
    return { responseText: Templates.Global.cancelOperation };
  }

  if (currentStep === 'awaiting_physical_cash') {
    const physical = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(physical)) return { responseText: Templates.Global.invalidNumber };
    let sinceTimestamp = '1970-01-01T00:00:00Z';
    const { data: lastCorte } = await supabase.from('cash_snapshots').select('closed_at').eq('store_id', storeId).order('closed_at', { ascending: false }).limit(1).maybeSingle();
    if (lastCorte) sinceTimestamp = lastCorte.closed_at;
    const { data: txs } = await supabase.from('transactions').select('amount_received').eq('store_id', storeId).gt('created_at', sinceTimestamp).is('is_voided', false);
    const expected = txs?.reduce((sum, tx) => sum + (Number(tx.amount_received) || 0), 0) || 0;
    const diff = physical - expected;
    return { responseText: Templates.Admin.cashCloseSummary(physical, expected, diff), nextStep: 'awaiting_corte_confirmation', metadata: { physical, expected, diff, since: sinceTimestamp } };
  }

  if (currentStep === 'awaiting_corte_confirmation') {
    if (isPositive(s)) return { responseText: Templates.Admin.cashCloseSuccess, metadata: { intent: 'PROCESS_CORTE', physical: metadata.physical, expected: metadata.expected, since: metadata.since } };
    return { responseText: Templates.Global.cancelOperation };
  }

  if (currentStep === 'awaiting_void_confirmation') {
    if (isPositive(s)) return { responseText: Templates.Admin.voidSaleSuccess, metadata: { intent: 'PROCESS_VOID', transactionId: metadata.transactionId, productId: metadata.productId, qty: metadata.qty } };
    return { responseText: Templates.Global.cancelOperation };
  }

  if (currentStep === 'awaiting_payment_ledgers_confirmation') {
    if (isPositive(s)) return { responseText: Templates.Ledger.ledgerPaymentSuccess(metadata.customerName), metadata: { intent: 'PROCESS_ABONO', customerId: metadata.customerId, amount: metadata.amount, customerName: metadata.customerName } };
    return { responseText: Templates.Global.cancelOperation };
  }

  if (currentStep === 'awaiting_audit_count') {
    const physical = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(physical)) return { responseText: Templates.Global.invalidNumber };
    const { products, currentIndex } = metadata; const currentProd = products[currentIndex];
    const diff = physical - currentProd.current_stock;
    if (diff !== 0) {
       await supabase.from('transactions').insert({ store_id: storeId, product_id: currentProd.id, type: 'correction', quantity_change: diff, notes: 'Auditoría WhatsApp' });
       await supabase.rpc('increment_stock', { row_id: currentProd.id, amount: diff });
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex < products.length) return { responseText: Templates.Admin.auditNext(nextIndex + 1, products[nextIndex].name), nextStep: 'awaiting_audit_count', metadata: { products, currentIndex: nextIndex } };
    return { responseText: Templates.Admin.auditFinished };
  }

  if (currentStep === 'awaiting_edit_selection') {
    if (s === '1' || s.includes('nombre')) return { responseText: Templates.Admin.editNamePrompt(metadata.editProdName), nextStep: 'awaiting_edit_name', metadata };
    if (s === '2' || s.includes('precio')) return { responseText: Templates.Admin.editPricePrompt(metadata.editProdName), nextStep: 'awaiting_edit_price', metadata };
    if (s === '3' || s.includes('costo')) return { responseText: Templates.Admin.editCostPrompt(metadata.editProdName), nextStep: 'awaiting_edit_cost', metadata };
  }

  if (currentStep === 'awaiting_edit_name') {
    await supabase.from('products').update({ name: text.trim() }).eq('id', metadata.editProdId);
    return { responseText: Templates.Admin.editSuccess };
  }

  if (currentStep === 'awaiting_edit_price' || currentStep === 'awaiting_edit_cost') {
    const val = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!isNaN(val)) {
      const field = currentStep === 'awaiting_edit_price' ? 'base_price' : 'last_cost_price';
      await supabase.from('products').update({ [field]: val }).eq('id', metadata.editProdId);
      return { responseText: Templates.Admin.editSuccess };
    }
  }

  // --- PRIORIDAD 3: PROCESAR INTENCIONES ---

  if (intentResult.intent === 'GET_INVENTORY' && storeId) {
    const { data: prods } = await supabase.from('products').select('name, current_stock').eq('store_id', storeId).eq('is_active', true).order('current_stock', { ascending: true }).limit(10);
    if (!prods || prods.length === 0) return { responseText: Templates.Inventory.emptyInventory };
    const list = prods.map(p => `${p.current_stock <= 0 ? '❌' : '📦'} ${p.name}: *${p.current_stock}*`).join('\n');
    return { responseText: Templates.Inventory.inventoryList(list) };
  }

  if (intentResult.intent === 'CREATE_STORE') return { responseText: Templates.Onboarding.newStorePrompt, nextStep: 'awaiting_new_store_name' };
  
  if (intentResult.intent === 'VOID_SALE') {
    const { data: lastTx } = await supabase.from('transactions').select('*, products(name)').eq('store_id', storeId).eq('type', 'sale').is('is_voided', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!lastTx) return { responseText: Templates.Admin.voidSaleNotFound };
    return { responseText: Templates.Admin.voidSaleConfirmation((lastTx as any).products.name, Math.abs(lastTx.quantity_change), lastTx.total_amount), nextStep: 'awaiting_void_confirmation', metadata: { transactionId: lastTx.id, productId: lastTx.product_id, qty: Math.abs(lastTx.quantity_change) } };
  }

  if (intentResult.intent === 'CASH_CLOSE') return { responseText: Templates.Admin.cashClosePrompt, nextStep: 'awaiting_physical_cash' };
  
  if (intentResult.intent === 'SWITCH_STORE') {
    const { data: profile } = await supabase.from('profiles').select('id').eq('store_id', storeId).maybeSingle();
    const { data: stores } = await supabase.from('stores').select('id, name').eq('owner_id', profile?.id);
    if (!stores || stores.length <= 1) return { responseText: Templates.Admin.switchStoreOnlyOne };
    return { responseText: Templates.Admin.switchStorePrompt(stores.map(s => `• ${s.name}`).join('\n')), nextStep: 'awaiting_store_switch' };
  }

  if (intentResult.intent === 'AUDIT_INVENTORY') {
    const { data: products } = await supabase.from('products').select('id, name, current_stock').eq('store_id', storeId).order('name', { ascending: true });
    if (!products || products.length === 0) return { responseText: Templates.Admin.auditEmpty };
    return { responseText: Templates.Admin.auditStart(products[0].name), nextStep: 'awaiting_audit_count', metadata: { products, currentIndex: 0 } };
  }

  if (intentResult.intent === 'ADD_PRODUCT') return { responseText: Templates.Onboarding.firstProductPrompt, nextStep: 'awaiting_first_product_name' };

  if (intentResult.intent === 'RESTOCK' && intentResult.product) {
    let searchTerm = intentResult.product;
    if (searchTerm.endsWith('s') && searchTerm.length > 3) searchTerm = searchTerm.slice(0, -1);

    // 1. Búsqueda Difusa (RPC)
    const { data: fuzzy } = await supabase.rpc('fuzzy_search_products', {
      search_text: searchTerm,
      store_id_param: storeId,
      similarity_threshold: 0.15
    });

    let bestMatch = fuzzy && fuzzy.length > 0 ? fuzzy[0] : null;

    // 2. Fallback: Búsqueda ILIKE con desempate por longitud
    if (!bestMatch || bestMatch.similarity < 0.3) {
      const { data: ilikeProds } = await supabase.from('products').select('id, name').eq('store_id', storeId).eq('is_active', true).ilike('name', `%${searchTerm}%`);
      if (ilikeProds && ilikeProds.length > 0) {
        const sorted = ilikeProds.sort((a, b) => Math.abs(a.name.length - searchTerm.length) - Math.abs(b.name.length - searchTerm.length));
        bestMatch = { ...sorted[0], similarity: 0.5 };
      }
    }

    if (bestMatch && bestMatch.similarity > 0.4) {
      return {
        responseText: Templates.Inventory.restockConfirmation(intentResult.qty, bestMatch.name),
        nextStep: 'awaiting_similarity_confirmation',
        metadata: { suggestedId: bestMatch.id, suggestedName: bestMatch.name, pendingQty: intentResult.qty, newName: intentResult.product }
      };
    }

    return {
      responseText: Templates.Inventory.productNotFound(intentResult.product),
      nextStep: 'awaiting_similarity_confirmation',
      metadata: { newName: intentResult.product, pendingQty: intentResult.qty }
    };
  }

  if (intentResult.intent === 'MULTI_SALE' && intentResult.items?.length > 0) {
    let total = 0; const foundItems = [];
    for (const item of intentResult.items) {
      let searchTerm = item.product;
      if (searchTerm.endsWith('s') && searchTerm.length > 3) searchTerm = searchTerm.slice(0, -1);

      // Búsqueda inteligente (Fuzzy + ILIKE Fallback)
      const { data: fuzzy } = await supabase.rpc('fuzzy_search_products', {
        search_text: searchTerm,
        store_id_param: storeId,
        similarity_threshold: 0.15
      });

      let bestMatch = fuzzy && fuzzy.length > 0 ? fuzzy[0] : null;
      if (!bestMatch || bestMatch.similarity < 0.3) {
        const { data: ilikeProds } = await supabase.from('products').select('id, name, base_price').eq('store_id', storeId).eq('is_active', true).ilike('name', `%${searchTerm}%`);
        if (ilikeProds && ilikeProds.length > 0) {
          const sorted = ilikeProds.sort((a, b) => Math.abs(a.name.length - searchTerm.length) - Math.abs(b.name.length - searchTerm.length));
          bestMatch = { ...sorted[0], base_price: sorted[0].base_price, similarity: 0.5 };
        }
      }

      if (bestMatch) { 
        total += item.qty * bestMatch.base_price; 
        foundItems.push({ productId: bestMatch.id, productName: bestMatch.name, qty: item.qty, price: bestMatch.base_price, lineTotal: item.qty * bestMatch.base_price }); 
      }
    }
    
    if (foundItems.length === 0) return { responseText: "❌ No encontré esos productos." };
    
    let responseText = '';
    if (foundItems.length === 1) {
      responseText = Templates.Sales.saleConfirmation(foundItems[0].qty, foundItems[0].productName, total);
    } else {
      const list = foundItems.map(i => `• ${i.qty}x ${i.productName} ($${i.lineTotal})`).join('\n');
      responseText = `🧾 *Resumen de Venta*\n\n${list}\n\n*Total:* *$${total}*\n\n¿Confirmas esta venta?`;
    }

    if (intentResult.isCredit) {
      return { responseText, nextStep: 'awaiting_debtor_name_direct', metadata: { items: foundItems, total, isCredit: true } };
    }

    return { responseText, nextStep: 'awaiting_sale_confirmation', metadata: { items: foundItems, total } };
  }

  if (intentResult.intent === 'GET_LINK') {
    const { data: user } = await supabase.from('profiles').select('id').eq('store_id', storeId).maybeSingle();
    return { responseText: Templates.Global.dashboardLink(storeId, user?.id || '') };
  }

  return { responseText: "" };
}
