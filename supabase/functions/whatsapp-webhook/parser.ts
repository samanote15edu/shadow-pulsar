import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CommandResponse {
  responseText: string;
  nextStep?: string;
  metadata?: any;
}

export function detectIntent(text: string): any {
  const s = text.toLowerCase().trim();
  const keywords = {
    restock: ['llegaron', 'llego', 'llegó', 'trajeron', 'trajo', 'resurtir', 'recibi', 'recibí'],
    sale: ['vendi', 'vendí', 'venta', 'dame', 'ponme', 'una', 'un', '2', '3', '4', '5']
  };

  if (keywords.restock.some(k => s.includes(k))) {
    const qty = s.match(/(\d+)/)?.[1];
    return { intent: 'RESTOCK', qty: qty ? parseInt(qty) : 1, product: s.replace(/llegaron|llego|llegó|\d+/g, '').trim() };
  }

  if (keywords.sale.some(k => s.includes(k) || /^\d+/.test(s))) {
    const qty = s.match(/(\d+)/)?.[1];
    return { intent: 'SALE', qty: qty ? parseInt(qty) : 1, product: s.replace(/vendi|vendí|venta|\d+/g, '').trim() };
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

  // 1. MANEJAR ESTADOS EXISTENTES (ALTA PRIORIDAD)
  if (currentStep === 'awaiting_similarity_confirmation') {
    if (['si', 'sí', 's', 'yes'].includes(s)) {
      return {
        responseText: `✅ Resurtido de **${metadata.pendingQty} ${metadata.suggestedName}** registrado.`,
        metadata: { intent: 'RESTOCK', productId: metadata.suggestedId, qty: metadata.pendingQty }
      };
    }
  }

  // 2. DETECTAR NUEVA INTENCIÓN
  const res = detectIntent(text);
  if (res.intent === 'RESTOCK') {
    // Búsqueda rápida
    const { data: fuzzy } = await supabase.rpc('fuzzy_search_products', {
      search_text: res.product.replace(/s$/, ''),
      store_id_param: storeId,
      similarity_threshold: 0.1
    });

    if (fuzzy && fuzzy.length > 0) {
      const best = fuzzy[0];
      if (best.similarity > 0.5) {
        return {
          responseText: `📦 ¿Confirmas ${res.qty} de **${best.name}**?`,
          nextStep: 'awaiting_restock_qty_guided',
          metadata: { productId: best.id, productName: best.name, qty: res.qty }
        };
      } else {
        return {
          responseText: `🔍 ¿Te refieres a **${best.name}** o es nuevo?`,
          nextStep: 'awaiting_similarity_confirmation',
          metadata: { suggestedId: best.id, suggestedName: best.name, newName: res.product, pendingQty: res.qty }
        };
      }
    }
  }

  return { responseText: "" };
}

export async function executeCommand(message: string, supabase: any, storeId: string, role: string, from: string, userId: string) {
    // Fallback minimalista para no romper nada
    return { responseText: "" };
}
