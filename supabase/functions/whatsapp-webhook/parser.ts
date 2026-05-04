import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CommandResponse {
  responseText: string;
  nextStep?: string;
  metadata?: any;
}

export function detectIntent(text: string): any {
  const s = text.toLowerCase().trim();
  const restockKeywords = ['llegaron', 'llego', 'llegó', 'trajeron', 'trajo', 'resurtir', 'recibi', 'recibí', 'surtido', 'entrada'];
  
  const isRestock = restockKeywords.some(k => s.includes(k));
  const qtyMatch = s.match(/(\d+)/);
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

  if (isRestock) {
    // Limpiar el texto para sacar el nombre del producto
    let product = s;
    restockKeywords.forEach(k => product = product.replace(k, ''));
    product = product.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    return { intent: 'RESTOCK', qty, product };
  }

  // Si empieza con número (ej: "2 cocas"), es una VENTA por defecto
  if (/^\d+/.test(s)) {
    const product = s.replace(/^\d+/, '').trim();
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

  // 1. MANEJAR RESPUESTAS A PREGUNTAS (ESTADOS)
  if (currentStep === 'awaiting_similarity_confirmation') {
    const isPositive = ['si', 'sí', 's', 'yes', 'va', 'dale'].includes(s);
    if (isPositive) {
      return {
        responseText: `✅ ¡Listo! Registré **${metadata.pendingQty} ${metadata.suggestedName}** en el inventario.`,
        metadata: { intent: 'RESTOCK', productId: metadata.suggestedId, qty: metadata.pendingQty }
      };
    } else {
      return {
        responseText: `✨ Entendido. Vamos a registrar **"${metadata.newName}"** como producto nuevo.\n\n¿A qué **precio** lo vas a vender?`,
        nextStep: 'awaiting_new_product_price',
        metadata: { newName: metadata.newName, pendingQty: metadata.pendingQty }
      };
    }
  }

  // 2. DETECTAR NUEVA INTENCIÓN
  const intentResult = detectIntent(text);
  console.log(`[DEBUG] Intent: ${intentResult.intent} | Product: "${intentResult.product}"`);

  if (intentResult.intent === 'RESTOCK' && intentResult.product) {
    let searchTerm = intentResult.product;
    // Normalización básica de plurales (cocas -> coca)
    if (searchTerm.endsWith('s') && searchTerm.length > 3) searchTerm = searchTerm.slice(0, -1);

    // 1. Búsqueda Difusa (Trigramas)
    const { data: fuzzy } = await supabase.rpc('fuzzy_search_products', {
      search_text: searchTerm,
      store_id_param: storeId,
      similarity_threshold: 0.15 // Bajamos el umbral para ser más permisivos
    });

    let bestMatch = fuzzy && fuzzy.length > 0 ? fuzzy[0] : null;

    // 2. Fallback: Búsqueda ILIKE (Si la difusa no convenció)
    if (!bestMatch || bestMatch.similarity < 0.3) {
      const { data: ilikeProds } = await supabase
        .from('products')
        .select('id, name')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .ilike('name', `%${searchTerm}%`)
        .limit(1);
      
      if (ilikeProds && ilikeProds.length > 0) {
        bestMatch = { ...ilikeProds[0], similarity: 0.5 }; // Le damos un score artificial para que dispare la sugerencia
      }
    }

    if (bestMatch) {
      if (bestMatch.similarity > 0.4) {
        return {
          responseText: `📦 ¿Confirmas resurtido de **${intentResult.qty} ${bestMatch.name}**?`,
          nextStep: 'awaiting_similarity_confirmation',
          metadata: { suggestedId: bestMatch.id, suggestedName: bestMatch.name, pendingQty: intentResult.qty, newName: intentResult.product }
        };
      }
    }

    // Si no hay match, ofrecer crear nuevo
    return {
      responseText: `🔍 No encontré "${intentResult.product}" en tu inventario.\n\n¿Quieres registrarlo como **producto nuevo**?`,
      nextStep: 'awaiting_similarity_confirmation', // Reusamos el estado para SI/NO
      metadata: { newName: intentResult.product, pendingQty: intentResult.qty, isNew: true }
    };
  }

  return { responseText: "" };
}

export async function executeCommand(message: string, supabase: any, storeId: string, role: string, from: string, userId: string) {
    // Fallback minimalista para no romper nada
    return { responseText: "" };
}
