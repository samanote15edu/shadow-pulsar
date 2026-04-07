import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

// --- CONFIGURACIÓN ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- LÓGICA DE PARSEO SILENCIOSA ---
async function executeCommand(message: string, sb: any, storeId: string) {
  const cleanMsg = message.trim();
  const lowerMsg = cleanMsg.toLowerCase();
  
  // Dashboard Link
  const dashboardKeywords = ['sistema', 'compu', 'link', 'panel', 'tablero', 'computadora'];
  if (dashboardKeywords.some(kw => lowerMsg.includes(kw))) {
    return { responseText: `🖥️ *Tu Panel Real*:\nhttps://shadow-pulsar.vercel.app/?s=${storeId}` };
  }

  // Ejemplo de inventario
  if (lowerMsg.includes('inventario')) {
    const { data: prods } = await sb.from('products').select('*').eq('store_id', storeId).limit(5);
    if (!prods || prods.length === 0) return { responseText: "Tu inventario está vacío. 📦" };
    let list = "📦 *Tu Inventario (Top 5)*:\n";
    prods.forEach((p: any) => list += `- ${p.name}: ${p.current_stock} pzas\n`);
    return { responseText: list };
  }

  // SILENCIO SI NO SE ENTIENDE (Evita el spam de Meta o de reintentos)
  return { responseText: null };
}

async function sendWhatsAppMessage(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
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
    const text = (message.text?.body || '').trim();
    const upperText = text.toUpperCase();

    // 1. Verificar si ya existe el perfil
    const { data: profile } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).single();

    if (profile) {
      const res = await executeCommand(text, supabase, profile.store_id);
      if (res.responseText) {
        await sendWhatsAppMessage(from, res.responseText);
      }
      return new Response('OK', { status: 200 });
    }

    // 2. LÓGICA DE REGISTRO PASO A PASO
    const { data: state } = await supabase.from('registration_states').select('*').eq('whatsapp_number', from).single();

    if (!state) {
      await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_invite_code' });
      await sendWhatsAppMessage(from, "¡Bienvenido! 🏪 Por favor ingresa tu *Código de Invitación* para comenzar.");
      return new Response('OK', { status: 200 });
    }

    if (state.step === 'awaiting_invite_code') {
      if (upperText === 'TIENDITA2026') {
        await supabase.from('registration_states').update({ step: 'awaiting_store_name' }).eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, "¡Código aceptado! ✅\n\n¿Cómo se llama tu negocio? (Solo el nombre)");
      } else {
        await sendWhatsAppMessage(from, "Código no válido. ❌");
      }
      return new Response('OK', { status: 200 });
    }

    if (state.step === 'awaiting_store_name') {
      if (upperText === 'TIENDITA2026') return new Response('OK', { status: 200 });
      await supabase.from('registration_states').update({ step: 'awaiting_owner_name', metadata: { store_name: text } }).eq('whatsapp_number', from);
      await sendWhatsAppMessage(from, `Entendido. Último paso:\n\n¿Cuál es tu nombre completo? (Dueño)`);
      return new Response('OK', { status: 200 });
    }

    if (state.step === 'awaiting_owner_name') {
      const storeName = state.metadata.store_name;
      const ownerName = text;

      // CREACIÓN FINAL
      const { data: newStore } = await supabase.from('stores').insert({ name: storeName }).select().single();
      await supabase.from('profiles').insert({ whatsapp_number: from, full_name: ownerName, role: 'owner', store_id: newStore.id });
      await supabase.from('registration_states').delete().eq('whatsapp_number', from);

      const link = `https://shadow-pulsar.vercel.app/?s=${newStore.id}`;
      await sendWhatsAppMessage(from, `¡Felicidades *${ownerName}*! 🚀 Tu tienda *${storeName}* ya está registrada.\n\nTU PANEL REAL:\n${link}`);
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error(`[ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
