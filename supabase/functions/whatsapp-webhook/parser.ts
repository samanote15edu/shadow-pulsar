import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Templates } from './templates.ts';

export interface CommandResponse {
  responseText: string;
  nextStep?: string;
  metadata?: any;
}

export function detectIntent(text: string): any {
  const s = text.toLowerCase().trim();

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
  const saleKeywords = ['vendi', 'vendí', 'vender', 'venta', 'sale', 'dame', 'ponme', 'despacha'];
  
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
    const items = segments.map(seg => {
       const qtyMatch = seg.match(/^(\d+(\.\d+)?)/);
       const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
       let product = seg.replace(/^(\d+(\.\d+)?)/, '').trim();
       product = product.replace(/^(?:(?:kilos|kilo|kg|gramos|gramo|gr|litros|litro|lt|paquetes|paquete|cajas|caja|piezas|pieza|pzas|pza|de)\b\s*)+/gi, '').trim();
       return { qty, product };
    }).filter(i => i.product.length > 0);

    if (items.length > 0) return { intent: 'MULTI_SALE', items };
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
    return ['no', 'n', 'cancelar', 'parar', 'reset', 'nel', 'nop', 'never', 'not', 'ni madres', 'nones'].includes(clean);
  };

  // --- PRIORIDAD 1: COMANDOS VIP (Funcionan siempre) ---
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
  if (!storeId && !currentStep) {
    return { responseText: Templates.Onboarding.welcomeInvite, nextStep: 'awaiting_invite_code' };
  }

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

  if (currentStep === 'awaiting_similarity_confirmation' || currentStep === 'awaiting_sale_confirmation' || currentStep === 'awaiting_new_store_confirmation') {
    if (isPositive(s)) {
      if (currentStep === 'awaiting_sale_confirmation') return { responseText: Templates.Sales.saleConfirmedPaymentChoice(metadata.total), nextStep: 'awaiting_payment_choice', metadata };
      if (currentStep === 'awaiting_new_store_confirmation') return { responseText: Templates.Onboarding.storeCreatedProcessing(metadata.newStoreName), nextStep: 'awaiting_first_product_choice', metadata: { intent: 'CREATE_NEW_BRANCH', name: metadata.newStoreName } };
      
      if (!metadata.suggestedId) {
        return { responseText: Templates.Onboarding.firstProductUnitPrompt, nextStep: 'awaiting_product_unit', metadata: { newName: metadata.newName, pendingQty: metadata.pendingQty === 1 ? 0 : metadata.pendingQty } };
      }
      return { responseText: Templates.Inventory.restockSuccess(metadata.pendingQty, metadata.suggestedName), metadata: { intent: 'RESTOCK', productId: metadata.suggestedId, qty: metadata.pendingQty } };
    } else if (isNegative(s)) {
      return { responseText: Templates.Global.cancelOperation };
    }
  }

  if (currentStep === 'awaiting_post_creation_action') {
    if (s.includes('inventario')) intentResult.intent = 'GET_INVENTORY';
    else if (s.match(/\bventa\b/)) intentResult.intent = 'GREETING'; // Fallback a hola para resetear
    else if (s.includes('agregar')) intentResult.intent = 'ADD_PRODUCT';
    else return { responseText: Templates.Global.unrecognized };
  }

  // --- PRIORIDAD 3: PROCESAR INTENCIONES ---
  if (intentResult.intent === 'GET_INVENTORY' && storeId) {
    const { data: prods } = await supabase.from('products').select('name, current_stock').eq('store_id', storeId).eq('is_active', true).order('current_stock', { ascending: true }).limit(10);
    if (!prods || prods.length === 0) return { responseText: Templates.Inventory.emptyInventory };
    const list = prods.map(p => `${p.current_stock <= 0 ? '❌' : '📦'} ${p.name}: *${p.current_stock}*`).join('\n');
    return { responseText: Templates.Inventory.inventoryList(list) };
  }

  if (intentResult.intent === 'RESTOCK' && intentResult.product) {
    let searchTerm = intentResult.product;
    if (searchTerm.endsWith('s') && searchTerm.length > 3) searchTerm = searchTerm.slice(0, -1);
    const { data: ilikeProds } = await supabase.from('products').select('id, name').eq('store_id', storeId).eq('is_active', true).ilike('name', `%${searchTerm}%`);
    if (ilikeProds && ilikeProds.length > 0) {
      const sorted = ilikeProds.sort((a, b) => Math.abs(a.name.length - searchTerm.length) - Math.abs(b.name.length - searchTerm.length));
      return { responseText: Templates.Inventory.restockConfirmation(intentResult.qty, sorted[0].name), nextStep: 'awaiting_similarity_confirmation', metadata: { suggestedId: sorted[0].id, suggestedName: sorted[0].name, pendingQty: intentResult.qty, newName: intentResult.product } };
    }
    return { responseText: Templates.Inventory.productNotFound(intentResult.product), nextStep: 'awaiting_similarity_confirmation', metadata: { newName: intentResult.product, pendingQty: intentResult.qty } };
  }

  if (intentResult.intent === 'MULTI_SALE' && intentResult.items?.length > 0) {
    let total = 0; const foundItems = [];
    for (const item of intentResult.items) {
      const { data: p } = await supabase.from('products').select('id, name, base_price').eq('store_id', storeId).ilike('name', `%${item.product}%`).limit(1).maybeSingle();
      if (p) { total += item.qty * p.base_price; foundItems.push({ productId: p.id, productName: p.name, qty: item.qty, price: p.base_price, lineTotal: item.qty * p.base_price }); }
    }
    if (foundItems.length === 0) return { responseText: "❌ No encontré esos productos." };
    return { responseText: Templates.Sales.saleConfirmation(foundItems[0].qty, foundItems[0].productName, total), nextStep: 'awaiting_sale_confirmation', metadata: { items: foundItems, total } };
  }

  if (intentResult.intent === 'GET_LINK') {
    const { data: user } = await supabase.from('profiles').select('id').eq('store_id', storeId).maybeSingle();
    return { responseText: Templates.Global.dashboardLink(storeId, user?.id || '') };
  }

  if (intentResult.intent === 'ADD_PRODUCT') {
    return { responseText: Templates.Onboarding.firstProductPrompt, nextStep: 'awaiting_first_product_name' };
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

  return { responseText: "" };
}
