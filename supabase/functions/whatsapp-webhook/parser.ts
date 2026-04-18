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
  nextStep?: 'awaiting_selection' | 'awaiting_confirmation' | 'awaiting_bulk_confirmation' | 'awaiting_fiado_approval' | 'awaiting_item_price' | 'awaiting_new_product_price' | 'awaiting_product_cost' | 'awaiting_new_product_details' | 'awaiting_similarity_confirmation' | 'awaiting_void_confirmation' | 'awaiting_physical_count' | 'awaiting_audit_selection' | 'awaiting_correction_amount' | 'awaiting_payment_confirmation' | 'awaiting_physical_cash' | 'awaiting_corte_confirmation' | 'awaiting_restock_qty_from_warning' | 'awaiting_cost_confirmation' | 'awaiting_price_confirmation';
  metadata?: any;
}

// Helper para búsqueda borrosa reutilizable
function findSimilarProduct(inputName: string, allProds: any[]) {
  const input = inputName.toLowerCase();
  const inputStem = input.length > 3 && input.endsWith('s') ? input.slice(0, -1) : input;
  
  return allProds?.find(p => {
    const dbName = p.name.toLowerCase();
    const dbStem = dbName.length > 3 && dbName.endsWith('s') ? dbName.slice(0, -1) : dbName;

    return dbName.includes(input) || 
           input.includes(dbName) || 
           dbName.includes(inputStem) || 
           inputStem.includes(dbName) ||
           dbStem.includes(input);
  });
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

  // 1. Check for basic queries (Inventario / Reporte / Ayuda)
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
       report += `• *${p.name}*: ${p.current_stock} ${p.unit_of_measure || 'pza'} ($${p.base_price})\n`;
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

      // Extract Quantity, Name, and Price from segment (e.g. "2 cocas a 20")
      const itemMatch = seg.trim().match(/^(?:(\d+)|(un|una))\s+([\s\w]+?)(?:\s+(?:a|de|por)\s+[\$]?([\d\.]+))?$/i);
      
      if (itemMatch) {
        const qty = itemMatch[1] ? parseInt(itemMatch[1], 10) : 1;
        const name = itemMatch[3].trim();
        const price = itemMatch[4] ? parseFloat(itemMatch[4]) : null;
        items.push({ name, qty, price });
      } else {
        items.push({ name: seg.trim(), qty: 1, price: null });
      }
    }

    // Determine next step
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

  // 4. BULK SALE SCANNER (Detects patterns like "2 cocas 1 gansito")
  // Regex looks for [Number] [Text] followed by another [Number] or end of string.
  const bulkRegex = /(\d+)\s+([a-zA-Z\xC0-\xFF\s]+?)(?=\s+\d+|\s*$)/g;
  const matches = [...cleanMsg.matchAll(bulkRegex)];

  if (matches.length > 0) {
    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true);
    const itemsToConfirm = [];
    let grandTotal = 0;
    let fallbackText = '';

    for (const match of matches) {
      const qty = parseInt(match[1], 10);
      const inputName = match[2].trim();
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
            name: product.name,
            qty,
            unit: product.unit_of_measure || 'pza',
            price: product.base_price,
            subtotal,
            warning
          });
        } else {
          fallbackText += `• No encontré "${inputName}".\n`;
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
    
    const magicLink = `https://shadow-pulsar.vercel.app/?s=${storeId}&u=${userId}`;
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
    const { data: tokenObj } = await supabase.from('report_tokens').insert({ store_id: storeId, access_level: 'admin' }).select().single();
    const scanLink = `https://yrjjajjmhirwkgldulzl.supabase.co/scan/${tokenObj?.token}`;
    return { responseText: `📱 *Escáner Activado*\n\nPULSA EL LINK PARA ABRIR LA CÁMARA:\n${scanLink}` };
  }
  
  // 14. MULTI-STORE MANAGEMENT (OWNER ONLY)
  if (userRole === 'owner') {
    // A. Create New Store
    const createStoreMatch = cleanMsg.match(/^Nueva tienda[:\s]\s*(.+)$/i);
    if (createStoreMatch) {
      const newStoreName = createStoreMatch[1].trim();
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
