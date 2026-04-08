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
  nextStep?: 'awaiting_selection' | 'awaiting_confirmation' | 'awaiting_fiado_approval' | 'awaiting_item_price' | 'awaiting_new_product_price' | 'awaiting_product_cost' | 'awaiting_new_product_details';
  metadata?: any;
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
       report += `• *${p.name}*: ${p.current_stock} pzas ($${p.base_price})\n`;
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
      // Pattern: [Qty or "un/una"] [Name] [optional: a/de/por $[Price]]
      const itemMatch = seg.trim().match(/^(?:(\d+)|(un|una))\s+([\s\w]+?)(?:\s+(?:a|de|por)\s+[\$]?([\d\.]+))?$/i);
      
      if (itemMatch) {
        const qty = itemMatch[1] ? parseInt(itemMatch[1], 10) : 1;
        const name = itemMatch[3].trim();
        const price = itemMatch[4] ? parseFloat(itemMatch[4]) : null;
        items.push({ name, qty, price });
      } else {
        // Fallback for simple names like "gansito" without quantity
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

  // 3. STOCK RESTOCK PARSER (e.g. "Surtido: 10 Sabritas" or "Surtido 5 Leche")
  const restockMatch = cleanMsg.match(/^Surtido[:\s]\s*(\d+)\s+(.+)$/i);
  if (restockMatch) {
    const qty = parseInt(restockMatch[1], 10);
    const productName = restockMatch[2].trim();

    // Check if product exists
    const { data: product } = await supabase
      .from('products')
      .select('*')
      .ilike('name', productName)
      .eq('store_id', storeId)
      .maybeSingle();

    if (product) {
      return {
        responseText: `📦 *Surtido: ${product.name}*\n\n¿Cuánto te costó cada unidad esta vez? (Costo anterior: $${product.last_cost_price || 0})`,
        nextStep: 'awaiting_product_cost',
        metadata: { productId: product.id, qty, productName: product.name }
      };
    } else {
      // New product flow
      return {
        responseText: `✨ *¡Nuevo Producto!* ✨\n\nNo encontré "${productName}" en tu inventario.\n\nPor favor, dime:\n1. ¿Cuánto te costó?\n2. ¿A cuánto lo venderás?\n\n(Ejemplo: 12 y 20)`,
        nextStep: 'awaiting_new_product_details',
        metadata: { productName, qty }
      };
    }
  }

  // 4. SALE PARSER (e.g. "Venta: 2 Coca Cola" or simply "2 Coca Cola")
  const saleMatch = lowerMsg.match(/^(?:venta:?\s*)?(\d+)\s+(.+)$/i);
  if (saleMatch) {
    const qty = parseInt(saleMatch[1]);
    const productName = saleMatch[2].trim();

    const { data: product } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeId)
      .ilike('name', `%${productName}%`)
      .maybeSingle();

    if (product) {
      const total = qty * product.base_price;
      return {
        responseText: `🥤 *Confirmar Venta*\n\nProducto: ${product.name}\nCantidad: ${qty}\nTotal: *$${total}*\n\n¿Confirmas la venta? (*SÍ* / *NO*)`,
        nextStep: 'awaiting_confirmation',
        metadata: { type: 'sale', productId: product.id, qty, productName: product.name, total, price: product.base_price }
      };
    } else {
      return { responseText: `❌ No encontré "${productName}" en tu inventario. Asegúrate de que el nombre sea correcto o usa *Surtido* para agregarlo.` };
    }
  }

  // 4. OTHER ROBUST PARSERS (Sale / Nuevo)
  // ... existing logic ...

  // 5. DASHBOARD ON DEMAND (Keywords: Sistema, Compu, Link, Panel, Tablero)
  const dashboardKeywords = ['sistema', 'compu', 'link', 'panel', 'tablero', 'computadora'];
  if (dashboardKeywords.includes(lowerMsg)) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden acceder al panel completo." };
    
    const magicLink = `https://shadow-pulsar.vercel.app/?s=${storeId}`;
    return { responseText: `🖥️ *Acceso al Panel de Control*\n\nAQUÍ TIENES TU LINK SEGURO:\n${magicLink}` };
  }

  // 6. BARCODE SCANNER (Keywords: Escanear, Lector, Cámara, Código)
  const scanKeywords = ['escanear', 'lector', 'cámara', 'camara', 'código', 'codigo'];
  if (scanKeywords.includes(lowerMsg)) {
    // Generate a SCAN Token (Expires in 1 hour for high-speed sessions)
    const { data: tokenObj } = await supabase.from('report_tokens').insert({ 
        store_id: storeId,
        access_level: 'admin' 
    }).select().single();

    const scanLink = `https://yrjjajjmhirwkgldulzl.supabase.co/scan/${tokenObj.token}`;
    return { responseText: `📱 *Escáner Activado*\n\nPULSA EL LINK PARA ABRIR LA CÁMARA:\n${scanLink}\n\n⚠️ Úsalo para Vender, Surtir o Registrar nuevos productos.` };
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
     
     // Clean formatting with dots . . . 
     const nameDisplay = `${item.qty} ${item.name}`;
     const dots = " . ".repeat(Math.max(1, 10 - Math.floor(nameDisplay.length / 2)));
     ticket += `${nameDisplay}${dots} $${lineTotal.toFixed(2)}\n`;
  }

  ticket += `---------------------------\n`;
  ticket += `*TOTAL: $${total.toFixed(2)}*\n\n`;
  ticket += `¿Es correcto? (*SÍ* / *NO*)`;

  return ticket;
}
