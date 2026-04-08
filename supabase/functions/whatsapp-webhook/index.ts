import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

// --- CONFIGURACIÓN ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- LÓGICA DE PARSEO ---
async function executeCommand(message: string, sb: any, storeId: string) {
  const cleanMsg = message.trim();
  const lowerMsg = cleanMsg.toLowerCase();
  
  if (lowerMsg.includes('link') || lowerMsg.includes('panel')) {
    return { responseText: `🖥️ *Tu Panel Real*:\nhttps://shadow-pulsar.vercel.app/?s=${storeId}` };
  }

  if (lowerMsg.includes('inventario')) {
    const { data: prods } = await sb.from('products').select('*').eq('store_id', storeId).limit(5);
    if (!prods || prods.length === 0) return { responseText: "Tu inventario está vacío. 📦" };
    let list = "📦 *Tu Inventario (Top 5)*:\n";
    prods.forEach((p: any) => list += `- ${p.name}: ${p.current_stock} pzas\n`);
    return { responseText: list };
  }

  return { responseText: null };
}

// Envío con Timeout para evitar que la función se cuelgue si Meta responde lento
async function sendWhatsAppMessage(to: string, text: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 segundos max

  try {
    await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- SERVIDOR PRINCIPAL ---
serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    return new Response(url.searchParams.get('hub.challenge'), { status: 200 });
  }

  try {
    const body = await req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return new Response('OK', { status: 200 });

    const from = message.from;
    const messageId = message.id; 
    const text = (message.text?.body || '').trim();
    const upperText = text.toUpperCase();

    // --- 1. BLOQUEO DE DUPLICADOS (IDEMPOTENCIA ESTRICTA) ---
    // Intentamos registrar que este mensaje está "en proceso"
    const { error: lockError } = await supabase
      .from('webhook_idempotency')
      .insert({ id: messageId, status: 'processing' });

    if (lockError) {
      // Si el ID ya existe, es un reintento de Meta. Ignoramos para evitar duplicados.
      console.info(`[LOCK] Ignorando reintento: ${messageId}`);
      return new Response('OK', { status: 200 });
    }

    // --- 2. CONSULTAS PARALELAS (PARA VELOCIDAD) ---
    const [profileRes, stateRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('whatsapp_number', from).maybeSingle(),
      supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle()
    ]);

    const profile = profileRes.data;
    const state = stateRes.data;

    // --- 3. LOGICA PRINCIPAL ---

    // A. Si ya es usuario registrado
    if (profile) {
      const res = await executeCommand(text, supabase, profile.store_id);
      if (res.responseText) {
        await sendWhatsAppMessage(from, res.responseText);
      }
      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // B. Flujo de Registro (Si NO es usuario)
    
    // Paso 1: Inicio (Si no hay estado previo)
    if (!state) {
      if (upperText === 'TIENDITA2026') {
        await supabase.from('registration_states').insert({ whatsapp_number: from, step: 'awaiting_store_name' });
        await sendWhatsAppMessage(from, "¡Código aceptado! ✅\n\n¿Cómo se llama tu negocio? (Solo el nombre)");
      }
      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // Paso 2: Nombre de la Tienda
    if (state.step === 'awaiting_store_name') {
      if (upperText === 'TIENDITA2026') {
        await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
        return new Response('OK', { status: 200 });
      }

      await supabase.from('registration_states').update({ 
        step: 'awaiting_owner_name', 
        metadata: { store_name: text } 
      }).eq('whatsapp_number', from);
      
      await sendWhatsAppMessage(from, `Entendido. Último paso:\n\n¿Cuál es tu nombre completo? (Dueño)`);
    }

    // Paso 3: Nombre del Dueño
    else if (state.step === 'awaiting_owner_name') {
      const storeName = state.metadata.store_name;
      const ownerName = text;

      const { data: newStore, error: storeErr } = await supabase.from('stores').insert({ name: storeName }).select().single();
      if (storeErr) throw storeErr;

      await supabase.from('profiles').insert({ 
        whatsapp_number: from, 
        full_name: ownerName, 
        role: 'owner', 
        store_id: newStore.id 
      });

      await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      const link = `https://shadow-pulsar.vercel.app/?s=${newStore.id}`;
      await sendWhatsAppMessage(from, `¡Felicidades *${ownerName}*! 🚀 Tu tienda *${storeName}* ya está registrada.\n\nTU PANEL REAL:\n${link}`);
    }

    // Marcar como completado y salir
    await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[CRITICAL ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
