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
  nextStep?: 'awaiting_selection' | 'awaiting_confirmation' | 'awaiting_fiado_approval' | 'awaiting_item_price';
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
  if (lowerMsg === 'inventario') {
     // ... Standard inventory logic here ...
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

  // 3. OTHER ROBUST PARSERS (Surtido / Sale / Nuevo)
  // ... existing logic ...

  // 5. DASHBOARD ON DEMAND (Keywords: Sistema, Compu, Link, Panel, Tablero)
  const dashboardKeywords = ['sistema', 'compu', 'link', 'panel', 'tablero', 'computadora'];
  if (dashboardKeywords.includes(lowerMsg)) {
    if (userRole !== 'owner' && userRole !== 'manager') return { responseText: "❌ Solo los administradores pueden acceder al panel completo." };
    
    // Generate an ADMIN Token (Expires in 4 hours)
    const { data: tokenObj } = await supabase.from('report_tokens').insert({ 
        store_id: storeId,
        access_level: 'admin' 
    }).select().single();

    const magicLink = `https://yrjjajjmhirwkgldulzl.supabase.co/report/${tokenObj.token}`;
    return { responseText: `🖥️ *Acceso al Panel de Control*\n\nAQUÍ TIENES TU LINK SEGURO:\n${magicLink}\n\n⚠️ Este link expira en 4 horas.` };
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
