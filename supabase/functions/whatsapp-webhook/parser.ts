/**
 * WhatsApp Command Parser for "Tiendita" Inventory (Robust Mexican Version)
 * Specialized for Multi-Item "Fiado" Lists
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

export interface FiadoItem {
  name: string;
  qty: number;
  price: number | null; // null means we need to ask the user
}

export interface CommandResponse {
  responseText: string;
  nextStep?: 'awaiting_selection' | 'awaiting_confirmation' | 'awaiting_bulk_confirmation' | 'awaiting_fiado_approval' | 'awaiting_item_price' | 'awaiting_new_product_price' | 'awaiting_product_cost' | 'awaiting_new_product_details' | 'awaiting_similarity_confirmation' | 'awaiting_void_confirmation' | 'awaiting_physical_count' | 'awaiting_audit_selection' | 'awaiting_correction_amount' | 'awaiting_payment_confirmation' | 'awaiting_physical_cash' | 'awaiting_corte_confirmation' | 'awaiting_restock_qty_from_warning' | 'awaiting_cost_confirmation' | 'awaiting_price_confirmation' | 'awaiting_sale_items_guided' | 'awaiting_sale_qty_guided' | 'awaiting_restock_name_guided' | 'awaiting_restock_qty_guided';
  metadata?: any;
}

// Helper para búsqueda borrosa reutilizable
function findSimilarProduct(inputName: string, allProds: any[]) {
  const input = inputName.toLowerCase().trim();
  const inputStem = input.length > 3 && input.endsWith('s') ? input.slice(0, -1) : input;
  
  return allProds?.find(p => {
    const dbName = p.name.toLowerCase().trim();
    const dbStem = dbName.length > 3 && dbName.endsWith('s') ? dbName.slice(0, -1) : dbName;

    return dbName === input ||
           dbName.includes(input) || 
           input.includes(dbName) || 
           dbName.includes(inputStem) || 
           inputStem.includes(dbName) ||
           dbStem.includes(input);
  });
}

/**
 * SMART ITEM PARSER
 * Extrae cantidad y nombre manejando pesos, fracciones y unidades.
 */
function smartParseItem(text: string): { qty: number; name: string; isWeight: boolean } {
  let s = text.toLowerCase().trim();
  let qty = 1;
  let isWeight = false;

  // 1. Diccionario de Fracciones
  const fractions: { [key: string]: number } = {
    'un cuarto': 0.25,
    '1/4': 0.25,
    'medio': 0.5,
    'un medio': 0.5,
    '1/2': 0.5,
    'tres cuartos': 0.75,
    '3/4': 0.75
  };

  // 2. Buscar Gramos (ej: 300g, 300 gramos, 300gr)
  const gramMatch = s.match(/(\d+)\s*(g|gr|gramos|grs)/i);
  if (gramMatch) {
    qty = parseInt(gramMatch[1], 10) / 1000;
    isWeight = true;
    s = s.replace(gramMatch[0], '').trim();
  } 
  
  // 3. Buscar Fracciones Literales (medio, un cuarto...)
  else {
    let foundFraction = false;
    for (const [key, value] of Object.entries(fractions)) {
      // Usar regex para asegurar que sea la palabra completa
      const reg = new RegExp(`\\b${key}\\b`, 'i');
      if (reg.test(s)) {
        qty = value;
        isWeight = true;
        s = s.replace(reg, '').trim();
        foundFraction = true;
        break;
      }
    }

    // 4. Buscar Kilos con decimales o enteros (ej: 1.5kg, 2 kilos)
    if (!foundFraction) {
      const kiloMatch = s.match(/(\d+[\.\/]?\d*)\s*(kg|kilo|kilos|k)/i);
      if (kiloMatch) {
        const val = kiloMatch[1];
        if (val.includes('/')) {
          const parts = val.split('/');
          qty = parseInt(parts[0]) / parseInt(parts[1]);
        } else {
          qty = parseFloat(val);
        }
        isWeight = true;
        s = s.replace(kiloMatch[0], '').trim();
      } else {
        // Fallback: Buscar número normal al principio o fin
        const startNumMatch = s.match(/^(\d+[\.\/]?\d*)\s+/);
        if (startNumMatch) {
          const val = startNumMatch[1];
          if (val.includes('/')) {
             const parts = val.split('/');
             qty = parseInt(parts[0]) / parseInt(parts[1]);
          } else {
             qty = parseFloat(val);
          }
          s = s.replace(startNumMatch[0], '').trim();
        } else {
          // Detectar "un", "una"
          const unMatch = s.match(/^(un|una|uno)\s+/i);
          if (unMatch) {
            qty = 1;
            s = s.replace(unMatch[0], '').trim();
          }
        }
      }
    }
  }

  // Limpieza final del nombre (quitar "de", "del", etc)
  const name = s.replace(/^(de|del|de un|de una)\s+/i, '').trim();
  
  return { qty, name, isWeight };
}

export async function executeCommand(
  message: string, 
  supabase: SupabaseClient, 
  storeId: string,
  userRole: string,
  userPhone: string,
  userId: string
): Promise<CommandResponse> {
  const cleanMsg = message.trim();
  const lowerMsg = cleanMsg.toLowerCase();
  const isAdmin = userRole === 'owner' || userRole === 'manager';

  // 1. Ayuda / Menu
  if (lowerMsg === 'ayuda' || lowerMsg === 'menu' || lowerMsg === 'comandos') {
     let help = "❓ *¿CÓMO PUEDO AYUDARTE?*\n\n";
     help += "• *Ventas:* Escribe '2 cocas' o '1 sabritas y 1 gansito'\n";
     help += "• *Inventario:* Escribe 'Inventario'\n";
     help += "• *Surtido:* Escribe 'Surtido: 10 Sabritas'\n";
     help += "• *Fiado:* Escribe 'Fiado [Nombre]: [Items]'\n";
     help += "• *Panel Web:* Escribe 'Link'\n";
     help += "• *Abono:* Escribe 'Abono [Nombre] [Monto]'\n\n";
     help += "Escribe *'Salir'* o *'Cancelar'* en cualquier momento para detener una operación.";
     return { responseText: help };
  }

  // 1.1 Salir / Cancelar (Global fallback)
  const exitKeywords = ['salir', 'cancelar', 'exit', 'cancel', 'parar', 'reset'];
  if (exitKeywords.includes(lowerMsg)) {
    return { responseText: "✅ No hay ninguna operación activa para cancelar. ¿En qué más puedo ayudarte?" };
  }

  // 2. Check for basic queries (Inventario / Reporte / Ayuda)
  if (lowerMsg === 'inventario' || lowerMsg === 'stock' || lowerMsg === 'todo') {
     const { data: prods } = await supabase
       .from('products')
       .select('*')
       .eq('store_id', storeId)
       .eq('is_active', true)
       .order('name', { ascending: true });

     if (!prods || prods.length === 0) {
       return { responseText: "📦 Tu inventario está vacío por ahora. ¡Usa 'Surtido' para agregar productos!" };
     }

     let report = "📦 *TU INVENTARIO ACTUAL*\n";
     report += "---------------------------\n";
     prods.forEach(p => {
       report += `• *${p.name.trim()}*: ${p.current_stock} ${p.unit_of_measure || 'pza'} ($${p.base_price})\n`;
     });
     report += "---------------------------";

     return { responseText: report };
  }

  // 2. MULTI-ITEM FIADO PARSER (e.g. "Fiado Maria: 2 cocas de 600, 1 pan de 10")
  const fiadoMatch = cleanMsg.match(/^Fiado\s+(.+?):\s*(.+)$/i);
  if (fiadoMatch) {
    const customer = fiadoMatch[1].trim();
    const content = fiadoMatch[2].trim();

    // Use our "Smart Splitter" to separate by comma or 'y' or 'con'
    const segments = content.split(/,|\s+y\s+|\s+con\s+/i);
    const items: FiadoItem[] = [];

    for (const seg of segments) {
      if (!seg.trim()) continue;

      let s = seg.trim();
      let price: number | null = null;
      let qty: number | null = null;
      let name = '';

      // 1. Extraer Precio (al final del todo)
      const priceMatch = s.match(/(?:\s+(?:a|de|por)\s+[\$]?([\d\.]+))$/i);
      if (priceMatch) {
        price = parseFloat(priceMatch[1]);
        s = s.slice(0, s.lastIndexOf(priceMatch[0])).trim();
      }

      // 2. Usar Smart Parser para Cantidad y Nombre
      const { qty: parsedQty, name: parsedName } = smartParseItem(s);
      qty = parsedQty;
      name = parsedName;

      items.push({ name, qty, price });
    }

    // Determine next step (Prioritize missing qty, then missing price)
    const missingQtyItem = items.find(i => i.qty === null);
    if (missingQtyItem) {
      return {
        responseText: `👤 *Fiado para ${customer}*\n\n¿Cuántas unidades de *${missingQtyItem.name}* se lleva?`,
        nextStep: 'awaiting_item_qty',
        metadata: { customer, items, currentIdx: items.indexOf(missingQtyItem) }
      };
    }

    const missingPriceItem = items.find(i => i.price === null);
    if (missingPriceItem) {
      return {
        responseText: `👤 *Fiado para ${customer}*\n\n¿A cuánto vendiste *${missingPriceItem.name}*?`,
        nextStep: 'awaiting_item_price',
        metadata: { customer, items, currentIdx: items.indexOf(missingPriceItem) }
      };
    }

    return {
      responseText: "Generando recibo...",
      nextStep: 'awaiting_fiado_approval',
      metadata: { customer, items }
    };
  }

  // 2.1 PARTIAL FIADO (Guided flow)
  if (lowerMsg === 'fiado' || lowerMsg === 'deuda' || lowerMsg === 'anotar') {
    return {
      responseText: "¿A quién le vamos a fiar? (Escribe el nombre del cliente)",
      nextStep: 'awaiting_fiado_name_guided'
    };
  }

  // 3. STOCK RESTOCK PARSER (e.g. "Surtido: 10 Sabritas")
  const restockMatch = cleanMsg.match(/^Surtido[:\s]\s*(\d+)\s+(.+)$/i);
  if (restockMatch) {
    const qty = parseInt(restockMatch[1], 10);
    const productName = restockMatch[2].trim();

    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true);
    const similar = findSimilarProduct(productName, allProds || []);

    if (similar) {
      if (similar.name.toLowerCase() === productName.toLowerCase()) {
        return {
          responseText: `📦 *Surtido: ${similar.name}*\n\n¿Cuánto te costó cada ${similar.unit_of_measure || 'unidad'} esta vez? (Costo anterior: $${similar.last_cost_price || 0})`,
          nextStep: 'awaiting_product_cost',
          metadata: { productId: similar.id, qty, productName: similar.name, unit: similar.unit_of_measure }
        };
      }
      return {
        responseText: `🔍 *He encontrado "${similar.name}"*\n\n¿Es el mismo producto que "${productName}"?`,
        nextStep: 'awaiting_similarity_confirmation',
        metadata: { productId: similar.id, qty, productName: similar.name, newName: productName, unit: similar.unit_of_measure }
      };
    } else {
      return {
        responseText: `✨ *¡Nuevo Producto!* ✨\n\nNo encontré "${productName}" en tu inventario.\n\nPor favor, dime:\n1. ¿Cuánto te costó?\n2. ¿A cuánto lo venderás?\n\n(Ejemplo: 12 y 20)`,
        nextStep: 'awaiting_new_product_details',
        metadata: { productName, qty }
      };
    }
  }

  // 3.1 PARTIAL RESTOCK (Guided flow)
  if (lowerMsg === 'surtido' || lowerMsg === 'resurtir' || lowerMsg === 'comprar') {
    return {
      responseText: "¿De qué producto te llegó mercancía? (Escribe el nombre)",
      nextStep: 'awaiting_restock_name_guided'
    };
  }

  if (lowerMsg.startsWith('surtido ')) {
    const productName = cleanMsg.slice(8).replace(/^[:\s]+/, '').trim();
    if (productName) {
      return {
        responseText: `¡Perfecto! ¿Cuántas unidades de *${productName}* te llegaron?`,
        nextStep: 'awaiting_restock_qty_guided',
        metadata: { productName }
      };
    }
  }

  // 4. BULK SALE SCANNER (Detects patterns like "2 cocas, medio de frijol")
  const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true);
  const itemsToConfirm = [];
  let grandTotal = 0;
  let fallbackText = '';

  // Split by commas or 'y' or 'con' if it's a long sentence
  const segments = cleanMsg.split(/,|\s+y\s+|\s+con\s+/i);

  for (const seg of segments) {
    if (!seg.trim()) continue;
    const { qty, name: inputName } = smartParseItem(seg);
    if (!inputName) continue; // Skip if no product name found
    
    const product = findSimilarProduct(inputName, allProds || []);

    if (product) {
      const subtotal = qty * product.base_price;
      grandTotal += subtotal;
      
      let warning = '';
      if (product.current_stock < qty) {
        warning = `⚠️ *Stock Insuficiente* (${product.current_stock} disp.)`;
      }

      itemsToConfirm.push({
        productId: product.id,
        name: product.name.trim(),
        qty,
        unit: product.unit_of_measure || 'pza',
        price: product.base_price,
        subtotal,
        warning
      });
    } else {
      // Solo agregamos a fallback si parece que intentó vender algo (tiene cantidad o nombre largo)
      if (inputName.length > 2) {
        fallbackText += `• No encontré "${inputName}".\n`;
      }
    }
  }

  if (itemsToConfirm.length > 0) {
    let ticket = `🥤 *Confirmar Venta*\n\n`;
    itemsToConfirm.forEach(it => {
      ticket += `• ${it.qty} ${it.unit} de ${it.name} ... $${it.subtotal}${it.warning ? `\n    ${it.warning}` : ''}\n`;
    });
    ticket += `--------------------------\n`;
    ticket += `*TOTAL: $${grandTotal}*\n`;
    
    const hasStockWarning = itemsToConfirm.some(it => it.warning);
    if (hasStockWarning) {
      ticket += `⚠️ _La venta forzará stock negativo en algunos items._\n`;
    }
    ticket += `\n`;
    
    if (fallbackText) {
      ticket += `⚠️ _Nota:_\n${fallbackText}`;
    }
    ticket += `¿Confirmas el ticket?`;

    return {
      responseText: ticket,
      nextStep: 'awaiting_bulk_confirmation',
      metadata: { items: itemsToConfirm, total: grandTotal }
    };
  }

  // 5. VOID / CANCEL LAST SALE COMMAND
  const voidKeywords = ['anular', 'cancelar venta', 'borrar venta', 'deshacer'];
  if (voidKeywords.some(k => lowerMsg.startsWith(k))) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden anular ventas." };
    
    // Find last sale transaction
    const { data: lastSale } = await supabase
      .from('transactions')
      .select('*, products(name)')
      .eq('store_id', storeId)
      .eq('type', 'sale')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lastSale) {
      return { responseText: "❌ No encontré ninguna venta reciente para anular." };
    }

    const prodName = (lastSale as any).products?.name || 'Producto desconocido';
    const qty = Math.abs(lastSale.quantity_change);

    return {
      responseText: `⚠️ *Confirmar Anulación*\n\n¿Deseas anular la última venta?\n• ${qty} ${prodName} ($${lastSale.total_amount})\n\nSe devolverá el stock al inventario.`,
      nextStep: 'awaiting_void_confirmation',
      metadata: { transactionId: lastSale.id, productId: lastSale.product_id, qty, productName: prodName, total: lastSale.total_amount }
    };
  }

  // 6. PHYSICAL COUNT INITIATION
  const inventoryKeywords = ['iniciar conteo', 'comenzar conteo', 'conteo fisico', 'conteo físico'];
  if (inventoryKeywords.some(k => lowerMsg.includes(k))) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden iniciar un conteo de inventario físico." };
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (!prods || prods.length === 0) {
      return { responseText: "❌ No hay productos en el inventario para contar." };
    }

    const first = prods[0];
    return {
      responseText: `🔍 *¡INICIANDO CONTEO FÍSICO!* 📋\n\nVamos uno por uno. Escribe la cantidad real que ves en el estante.\n\n*Producto 1/${prods.length}: ${first.name}*\n📦 El sistema dice que hay: *${first.current_stock}*\n\n¿Cuántos hay físicamente? (Escribe 'Saltar' o 'Fin' si es necesario)`,
      nextStep: 'awaiting_physical_count',
      metadata: { productsIds: prods.map(p => p.id), names: prods.map(p => p.name), stocks: prods.map(p => p.current_stock), currentIndex: 0 }
    };
  }

  // 7. DIRECT COST ADJUSTMENT (e.g. "Costo Coca 15", "Cost Coca 15", "Compra Coca 15")
  const costAdjustMatch = cleanMsg.match(/^(Costo|Cost|Compra)\s+(.+?)(?:\s*[:]\s*|\s+)([\d\.]+)$/i);
  if (costAdjustMatch) {
    const productName = costAdjustMatch[1].trim();
    const newCost = parseFloat(costAdjustMatch[2]);

    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true);
    const product = findSimilarProduct(productName, allProds || []);

    if (product) {
      return {
        responseText: `🔧 *Ajuste de Costo*\n\n¿Confirmas cambiar el costo de *${product.name}*?\n• Costo anterior: $${product.last_cost_price || 0}\n• Nuevo costo: *$${newCost}*\n\n(Esto no afecta el inventario)`,
        nextStep: 'awaiting_cost_confirmation',
        metadata: { productId: product.id, productName: product.name, newCost }
      };
    } else {
      return { responseText: `❌ No encontré el producto "${productName}" para ajustar su costo.` };
    }
  }

  // 8. DIRECT SALE PRICE ADJUSTMENT (e.g. "Precio Coca 20", "Price Coca 20", "Venta Coca 20")
  const priceAdjustMatch = cleanMsg.match(/^(Precio|Price|Venta)\s+(.+?)(?:\s*[:]\s*|\s+)([\d\.]+)$/i);
  if (priceAdjustMatch) {
    const productName = priceAdjustMatch[1].trim();
    const newPrice = parseFloat(priceAdjustMatch[2]);

    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true);
    const product = findSimilarProduct(productName, allProds || []);

    if (product) {
      return {
        responseText: `💰 *Ajuste de Precio de Venta*\n\n¿Confirmas cambiar el precio de venta de *${product.name}*?\n• Precio anterior: $${product.base_price}\n• Nuevo precio: *$${newPrice}*`,
        nextStep: 'awaiting_price_confirmation',
        metadata: { productId: product.id, productName: product.name, newPrice }
      };
    } else {
      return { responseText: `❌ No encontré el producto "${productName}" para ajustar su precio.` };
    }
  }

  // 9. DEBT PAYMENT / ABONO (e.g. "Abono Tito 50", "Pago Alex 100", "Payment Rosa 20")
  const paymentMatch = cleanMsg.match(/^(Abono|Pago|Payment)\s+(.+?)(?:\s*[:]\s*|\s+)([\d\.]+)$/i);
  if (paymentMatch) {
    const customerName = paymentMatch[2].trim();
    const amount = parseFloat(paymentMatch[3]);

    if (isNaN(amount) || amount <= 0) {
      return { responseText: "❌ El monto del abono debe ser un número válido mayor a 0." };
    }

    return {
      responseText: `💰 *Confirmar Abono*\n\n¿Registrar pago de *$${amount}* para *${customerName}*?`,
      nextStep: 'awaiting_payment_ledgers_confirmation',
      metadata: { customerName, amount }
    };
  }

  // 9.1 PARTIAL ABONO (Guided flow)
  if (lowerMsg === 'abono' || lowerMsg === 'pago' || lowerMsg === 'cobro' || lowerMsg === 'cobrar') {
    return {
      responseText: "¿Quién está realizando el pago?",
      nextStep: 'awaiting_abono_name_guided'
    };
  }

  // 9. CORRECTION / RETROACTIVE PAYMENT FIX
  const correctionKeywords = ['corregir', 'arreglar', 'ajustar pago', 'pago parcial'];
  if (correctionKeywords.some(k => lowerMsg.includes(k))) {
    const { data: lastSale } = await supabase
      .from('transactions')
      .select('*, products(name)')
      .eq('store_id', storeId)
      .eq('type', 'sale')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lastSale) return { responseText: "❌ No encontré ventas recientes para corregir." };

    const prodName = (lastSale as any).products?.name || 'Varios';
    return {
      responseText: `🔧 *Corregir Última Venta*\n\nVenta: ${prodName} ($${lastSale.total_amount})\n\n¿Cuánto recibiste realmente en efectivo? (Lo demás se irá a cuenta fiado)`,
      nextStep: 'awaiting_correction_amount',
      metadata: { transactionId: lastSale.id, total: lastSale.total_amount, productName: prodName }
    };
  }

  // 8. SALES AUDIT / UNRECONCILED
  const auditKeywords = ['auditoria', 'auditoría', 'pendientes', 'ventas sin cobrar'];
  if (auditKeywords.some(k => lowerMsg.includes(k))) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden auditar." };

    const { data: unreconciled } = await supabase
      .from('transactions')
      .select('*, products(name)')
      .eq('store_id', storeId)
      .eq('type', 'sale')
      .is('amount_received', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!unreconciled || unreconciled.length === 0) {
      return { responseText: "✅ Todas las ventas recientes tienen su pago conciliado." };
    }

    let report = "🔎 *AUDITORÍA DE VENTAS PENDIENTES*\n\n";
    unreconciled.forEach((u, i) => {
      const name = (u as any).products?.name || 'Venta';
      report += `${i + 1}. ${name} ($${u.total_amount})\n`;
    });
    report += `\n¿Quieres completar la info de alguna? (Escribe el número o 'No')`;

    return {
      responseText: report,
      nextStep: 'awaiting_audit_selection',
      metadata: { items: unreconciled }
    };
  }

  // 10. CORTE DE CAJA (Inicia el flujo ciego)
  const corteKeywords = ['corte', 'cerrar caja', 'cerrar dia', 'cerrar día', 'corte de caja'];
  if (corteKeywords.some(k => lowerMsg === k)) {
     if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden realizar el corte." };
     
     return {
       responseText: "🔐 *INICIANDO CORTE CIEGO*\n\nPor favor, escribe el monto total de efectivo que tienes físicamente en la caja ahora mismo.",
       nextStep: 'awaiting_physical_cash'
     };
  }

  // 11. DASHBOARD / LINK ON DEMAND
  const dashboardKeywords = ['link', 'sistema', 'web', 'dashboard', 'pagina', 'página', 'reporte', 'compu', 'panel', 'tablero', 'computadora'];
  if (dashboardKeywords.some(k => lowerMsg.includes(k))) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden acceder al panel completo." };
    
    const baseUrl = `https://shadow-pulsar.vercel.app`;
    const userPart = `u=${userId}`;
    
    if (userRole === 'owner') {
      let msg = `🖥️ *Panel de Control (Dueño)*\n\n`;
      msg += `🌐 *Vista Global (Todas tus tiendas):*\n${baseUrl}/?${userPart}\n\n`;
      msg += `📍 *Sucursal Actual:* \n${baseUrl}/?s=${storeId}&${userPart}\n\n`;
      msg += `⚠️ Mantén estos links en privado.`;
      return { responseText: msg };
    }
    
    const magicLink = `${baseUrl}/?s=${storeId}&${userPart}`;
    return { responseText: `🖥️ *Acceso al Panel de Control*\n\nTu link seguro para entrar al Dashboard:\n${magicLink}\n\n⚠️ Mantén este link en privado.` };
  }

  // 12. INVITE EMPLOYEE COMMAND
  if (lowerMsg === 'invitar empleado' || lowerMsg === 'invitar') {
    if (userRole !== 'owner') return { responseText: "❌ Solo el dueño de la tienda puede invitar empleados." };

    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    const inviteCode = `EMP-${randomStr}`;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await supabase.from('invite_codes').insert({
      code: inviteCode,
      max_uses: 1,
      metadata: { store_id: storeId, role: 'employee' },
      expires_at: expiresAt.toISOString()
    });

    let msg = `🎟️ *INVITACIÓN PARA EMPLEADO*\n\n`;
    msg += `Has generado un código de acceso para un nuevo colaborador:\n\n`;
    msg += `Código: *${inviteCode}*\n`;
    msg += `⏰ Vence en: 24 horas (${expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})\n\n`;
    msg += `*Instrucciones para el empleado:*\n`;
    msg += `1. Escribir "Hola" a este número de WhatsApp.\n`;
    msg += `2. Cuando el bot pida el código, enviar: *${inviteCode}*`;
    
    return { responseText: msg };
  }

  // 10. BARCODE SCANNER
  const scanKeywords = ['escanear', 'lector', 'cámara', 'camara', 'código', 'codigo'];
  if (scanKeywords.includes(lowerMsg)) {
    const { data: tokenObj } = await supabase.from('report_tokens').insert({ 
      store_id: storeId, 
      access_level: 'admin',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
    }).select().single();

    const baseUrl = `https://shadow-pulsar.vercel.app/scan/${tokenObj?.token}`;
    
    let msg = `📱 *Módulo de Escaneo*\n\n`;
    msg += `Selecciona el modo de uso:\n\n`;
    msg += `🛍️ *Venta:* \n${baseUrl}\n\n`;
    msg += `📦 *Surtido:* \n${baseUrl}?m=inventory\n\n`;
    msg += `_Este link vence en 1 hora._`;
    
    return { responseText: msg };
  }
  
  // 14. MULTI-STORE MANAGEMENT (OWNER ONLY)
  if (userRole === 'owner') {
    // A. Create New Store (Robust & Flexible)
    const creationKeywords = ['nueva tienda', 'nueva sucursal', 'crear tienda', 'crear sucursal', 'agregar tienda', 'agregar sucursal'];
    const startsWithKeyword = creationKeywords.some(k => lowerMsg.startsWith(k));
    
    if (startsWithKeyword) {
      // Extract name (handle both "Nueva tienda: Nombre" and "Nueva tienda Nombre")
      let newStoreName = '';
      for (const k of creationKeywords) {
          if (lowerMsg.startsWith(k)) {
              newStoreName = cleanMsg.slice(k.length).replace(/^[:\s]+/, '').trim();
              break;
          }
      }

      if (!newStoreName) {
        return { 
          nextStep: 'awaiting_company_name', 
          metadata: { business_type: 'inventory' },
          responseText: '🏢 *Crear Nueva Sucursal*\n\n¿Cómo se llamará la nueva tienda? (Escribe el nombre)' 
        };
      }

      const { data: newStore, error } = await supabase.from('stores').insert({
        name: newStoreName,
        owner_id: userId,
        logo_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(newStoreName)}`,
        description: 'Nueva sucursal'
      }).select().single();

      if (error) return { responseText: `❌ Error al crear la tienda: ${error.message}` };

      // Switch context immediately
      await supabase.from('profiles').update({ store_id: newStore.id }).eq('id', userId);

      return { responseText: `✨ *¡Nueva Tienda Creada!* ✨\n\nNombre: *${newStore.name}*\n\nAhora estás gestionando esta sucursal. Puedes añadir productos usando 'Surtido'.` };
    }

    // B. List Stores
    if (lowerMsg === 'tiendas' || lowerMsg === 'mis tiendas') {
      const { data: stores } = await supabase.from('stores').select('*').eq('owner_id', userId).order('name');
      if (!stores || stores.length === 0) return { responseText: "🏢 No tienes tiendas registradas aún." };

      let list = "🏢 *TUS TIENDAS*\n\n";
      stores.forEach((s, i) => {
        const isActive = s.id === storeId;
        list += `${i + 1}. ${isActive ? '✅ ' : '⚪ '} *${s.name}*\n`;
      });
      list += "\nEscribe *'Usar [Nombre]'* para cambiar de sucursal.";
      return { responseText: list };
    }

    // C. Switch Active Store
    const switchMatch = cleanMsg.match(/^Usar\s+(.+)$/i);
    if (switchMatch) {
      const targetName = switchMatch[1].trim();
      const { data: stores } = await supabase.from('stores').select('*').eq('owner_id', userId);
      
      const target = stores?.find(s => s.name.toLowerCase().includes(targetName.toLowerCase()));
      if (!target) return { responseText: `❌ No encontré ninguna tienda que se llame "${targetName}".` };

      const { error } = await supabase.from('profiles').update({ store_id: target.id }).eq('id', userId);
      if (error) return { responseText: `❌ Error al cambiar de tienda: ${error.message}` };

      return { responseText: `📍 *Cambio de Sucursal*\n\nAhora estás gestionando: *${target.name}*` };
    }
  }

  // 15. CONTEXTUAL PRODUCT DETECTION (Final fallback)
  // If it's a single word or short phrase, check if it's a product
  if (cleanMsg.length >= 3 && cleanMsg.length <= 25) {
    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true);
    const potentialProduct = findSimilarProduct(cleanMsg, allProds || []);
    if (potentialProduct) {
      return {
        responseText: `¡Claro! ¿Cuántas unidades de *${potentialProduct.name}* vendiste?`,
        nextStep: 'awaiting_contextual_product_qty',
        metadata: { productId: potentialProduct.id, productName: potentialProduct.name, price: potentialProduct.base_price }
      };
    }
  }

  return { responseText: "🤔 No entendí. Prueba con: 'Inventario', '2 cocas' o 'Escanear'." };
}

// Visual Receipt Formatter (Used in index.ts)
export function generateVisualReceipt(customer: string, items: FiadoItem[]): string {
  let total = 0;
  let ticket = `📑 *RECIBO DE FIADO*\n`;
  ticket += `---------------------------\n`;
  ticket += `*Cliente:* ${customer}\n\n`;

  for (const item of items) {
     const lineTotal = (item.qty || 1) * (item.price || 0);
     total += lineTotal;
     ticket += `${item.qty} ${item.name} . . . $${lineTotal.toFixed(2)}\n`;
  }

  ticket += `---------------------------\n`;
  ticket += `*TOTAL: $${total.toFixed(2)}*\n\n`;
  ticket += `¿Es correcto?`;

  return ticket;
}
