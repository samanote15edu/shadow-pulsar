import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
import { handleCommand, executeCommand } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendWhatsAppMessage(to: string, text: string) {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
  await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
}

async function sendWhatsAppButtons(to: string, bodyText: string, buttons: { id: string, title: string }[]) {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
  await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) }
      }
    })
  });
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ");
}

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

    // 1. BLOQUEO DE DUPLICADOS
    const { error: lockError } = await supabase.from('webhook_idempotency').insert({ id: messageId, status: 'processing' });
    if (lockError) return new Response('OK', { status: 200 });

    // 2. EXTRAER TEXTO
    let text = '';
    if (message.type === 'interactive') {
      text = message.interactive.button_reply.title;
    } else {
      text = (message.text?.body || '').trim();
    }

    if (!text) return new Response('OK', { status: 200 });

    // 3. BUSCAR PERFIL Y ESTADO
    const { data: profile } = await supabase.from('profiles').select('*, stores(*)').eq('whatsapp_number', from).maybeSingle();
    const { data: convState } = await supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle();

    if (!profile) {
      const step = convState?.step;

      // 1. Manejar Código de Invitación
      if (!step) {
        if (normalizeText(text).length >= 5) {
          const { data: invite } = await supabase.from('invite_codes').select('*').eq('code', text.toUpperCase()).eq('is_active', true).maybeSingle();
          if (invite) {
            await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_store_name', metadata: { inviteCode: invite.code } });
            await sendWhatsAppMessage(from, "¡Código aceptado! ✅ ¿Cómo se llama tu negocio?");
            return new Response('OK', { status: 200 });
          }
        }
        await sendWhatsAppMessage(from, "👋 ¡Hola! Para unirte a Shadow Pulsar, por favor escribe tu código de invitación.");
        return new Response('OK', { status: 200 });
      }

      // 2. Manejar Onboarding
      if (step === 'awaiting_store_name') {
        await supabase.from('registration_states').update({ step: 'awaiting_business_type', metadata: { ...convState.metadata, storeName: text } }).eq('whatsapp_number', from);
        await sendWhatsAppButtons(from, `🏪 *${text}*\n\n¿Qué tipo de negocio es?`, [
          { id: 'inventory', title: 'Inventario 📦' },
          { id: 'activity_logs', title: 'Bitácora 📝' }
        ]);
        return new Response('OK', { status: 200 });
      }

      if (step === 'awaiting_business_type') {
        const type = text.toLowerCase().includes('inventario') ? 'inventory' : 'activity_logs';
        const { data: store } = await supabase.from('stores').insert({ name: convState.metadata.storeName, business_type: type }).select().single();
        if (store) {
          await supabase.from('profiles').insert({ whatsapp_number: from, role: 'owner', store_id: store.id, full_name: 'Dueño' });
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `🎉 ¡Felicidades! Tu negocio *${store.name}* ha sido registrado.\n\nYa puedes empezar escribiendo: 'Inventario'`);
        }
        return new Response('OK', { status: 200 });
      }

      return new Response('OK', { status: 200 });
    }

    // 4. LÓGICA CONVERSACIONAL (NUEVA)
    console.log(`[BOT] User: ${from} | Text: ${text} | State: ${convState?.step}`);
    const convRes = await handleCommand(text, profile.store_id, supabase, profile.full_name || 'Amigo', convState);

    if (convRes && convRes.responseText) {
      const meta = convRes.metadata;

      // --- EJECUCIÓN DE COMANDOS EN DB ---
      if (!convRes.nextStep && meta?.intent === 'RESTOCK') {
        await supabase.rpc('increment_stock', { row_id: meta.productId, amount: meta.qty });
        await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: meta.productId, type: 'restock', quantity_change: meta.qty });
      }

      if (!convRes.nextStep && meta?.intent === 'CREATE_PRODUCT') {
        const { data: newProd } = await supabase.from('products').insert({
          store_id: profile.store_id,
          name: meta.name,
          base_price: meta.price,
          last_cost_price: meta.cost,
          current_stock: meta.qty
        }).select().single();
        if (newProd) {
          await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: newProd.id, type: 'restock', quantity_change: meta.qty, unit_price: meta.cost });
        }
      }

      if (!convRes.nextStep && meta?.intent === 'SALE') {
        await supabase.rpc('increment_stock', { row_id: meta.productId, amount: -meta.qty });
        await supabase.from('transactions').insert({ 
          store_id: profile.store_id, 
          product_id: meta.productId, 
          type: 'sale', 
          quantity_change: -meta.qty, 
          total_amount: meta.total,
          amount_received: meta.total // Asumimos pago completo por ahora
        });
      }

      if (convRes.nextStep) {
        await supabase.from('registration_states').upsert({ 
          whatsapp_number: from, 
          step: convRes.nextStep, 
          metadata: meta 
        });
      } else {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      if (convRes.nextStep?.includes('confirmation')) {
        await sendWhatsAppButtons(from, convRes.responseText, [
          { id: 'yes', title: 'SÍ ✅' },
          { id: 'no', title: 'NO ❌' }
        ]);
      } else {
        await sendWhatsAppMessage(from, convRes.responseText);
      }
      
      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // 5. FALLBACK A COMANDOS LEGADOS (Minimalista)
    const res = await executeCommand(text, supabase, profile.store_id, profile.role, from, profile.id);
    if (res.responseText) {
      await sendWhatsAppMessage(from, res.responseText);
    } else {
      await sendWhatsAppMessage(from, "🤔 No entendí. Prueba con: 'Inventario' o una lista como '2 cocas'.");
    }

    await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[CRITICAL ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
