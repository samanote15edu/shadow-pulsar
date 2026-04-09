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
  nextStep?: 'awaiting_selection' | 'awaiting_confirmation' | 'awaiting_bulk_confirmation' | 'awaiting_fiado_approval' | 'awaiting_item_price' | 'awaiting_new_product_price' | 'awaiting_product_cost' | 'awaiting_new_product_details' | 'awaiting_similarity_confirmation' | 'awaiting_void_confirmation';
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
  userPhone: string
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

    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId);
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
    const { data: allProds } = await supabase.from('products').select('*').eq('store_id', storeId);
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
        itemsToConfirm.push({
          productId: product.id,
          name: product.name,
          qty,
          unit: product.unit_of_measure || 'pza',
          price: product.base_price,
          subtotal
        });
      } else {
        fallbackText += `• No encontré "${inputName}".\n`;
      }
    }

    if (itemsToConfirm.length > 0) {
      let ticket = `🥤 *Confirmar Venta*\n\n`;
      itemsToConfirm.forEach(it => {
        ticket += `• ${it.qty} ${it.unit} de ${it.name} ... $${it.subtotal}\n`;
      });
      ticket += `--------------------------\n`;
      ticket += `*TOTAL: $${grandTotal}*\n\n`;
      
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

  // 6. DASHBOARD ON DEMAND
  const dashboardKeywords = ['sistema', 'compu', 'link', 'panel', 'tablero', 'computadora'];
  if (dashboardKeywords.includes(lowerMsg)) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden acceder al panel completo." };
    const magicLink = `https://shadow-pulsar.vercel.app/?s=${storeId}`;
    return { responseText: `🖥️ *Acceso al Panel de Control*\n\nAQUÍ TIENES TU LINK SEGURO:\n${magicLink}` };
  }

  // 6. BARCODE SCANNER
  const scanKeywords = ['escanear', 'lector', 'cámara', 'camara', 'código', 'codigo'];
  if (scanKeywords.includes(lowerMsg)) {
    const { data: tokenObj } = await supabase.from('report_tokens').insert({ store_id: storeId, access_level: 'admin' }).select().single();
    const scanLink = `https://yrjjajjmhirwkgldulzl.supabase.co/scan/${tokenObj.token}`;
    return { responseText: `📱 *Escáner Activado*\n\nPULSA EL LINK PARA ABRIR LA CÁMARA:\n${scanLink}` };
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
