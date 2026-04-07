import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'
import { executeCommand, generateVisualReceipt } from './parser.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendWhatsAppMessage(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body: text } })
  });
}

serve(async (req) => {
  if (req.method === 'GET') {
     const url = new URL(req.url);
     if (url.searchParams.get('hub.mode') === 'subscribe') return new Response(url.searchParams.get('hub.challenge'), { status: 200 });
  }

  try {
    const body = await req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return new Response('OK', { status: 200 });

    const from = message.from;
    const text = (message.text?.body || '').trim();
    const upperText = text.toUpperCase();

    console.log(`[LOG] Incoming Message from: ${from}`);
    console.log(`[LOG] Text received: ${text}`);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*, stores(*)')
      .eq('whatsapp_number', from)
      .single();

    if (profileError) {
      console.log(`[LOG] Database Error or No Profile: ${profileError.message}`);
    } else {
      console.log(`[LOG] Profile Found: ${profile.full_name} for Store: ${profile.stores?.name}`);
    }
    const { data: state } = await supabase.from('registration_states').select('*').eq('whatsapp_number', from).single();

    if (profile) {
      // 1. HANDLE FIADO FALLBACKS (Price asking)
      if (state?.step === 'awaiting_item_price') {
        const amount = parseFloat(text.replace(/[^\d\.]/g, ''));
        const items = state.metadata.items;
        items[state.metadata.currentIdx].price = amount;

        const nextMissing = items.find((i: any) => i.price === null);
        if (nextMissing) {
           await supabase.from('registration_states').update({ 
               metadata: { ...state.metadata, items, currentIdx: items.indexOf(nextMissing) } 
           }).eq('whatsapp_number', from);
           await sendWhatsAppMessage(from, `¿A cuánto vendiste *${nextMissing.name}*?`);
        } else {
           await supabase.from('registration_states').update({ step: 'awaiting_fiado_approval', metadata: { ...state.metadata, items } }).eq('whatsapp_number', from);
           await sendWhatsAppMessage(from, generateVisualReceipt(state.metadata.customer, items));
        }
        return new Response('OK', { status: 200 });
      }

      // 2. HANDLE FINAL FIADO APPROVAL (SÍ / NO)
      if (state?.step === 'awaiting_fiado_approval') {
         if (upperText === 'SÍ' || upperText === 'SI') {
            let total = 0;
            for (const item of state.metadata.items) {
               total += (item.qty * item.price);
               // Log each item as a transaction (History)
               await supabase.from('transactions').insert({
                   store_id: profile.store_id,
                   type: 'fiado_payment', // In our schema, this tracks debt parts
                   quantity_change: -item.qty,
                   total_amount: item.qty * item.price,
                   source: 'whatsapp'
               });
            }
            // Update Ledger
            const { data: ledger } = await supabase.from('fiado_ledgers').select('*').eq('store_id', profile.store_id).ilike('customer_name', `%${state.metadata.customer}%`).limit(1).single();
            const newBal = (ledger?.current_balance || 0) + total;
            if (ledger) await supabase.from('fiado_ledgers').update({ current_balance: newBal }).eq('id', ledger.id);
            else await supabase.from('fiado_ledgers').insert({ store_id: profile.store_id, customer_name: state.metadata.customer, current_balance: total });

            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `✅ Deuda guardada para *${state.metadata.customer}*. Nuevo saldo: *$${newBal.toFixed(2)}*`);
         } else {
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, "Cancelado. ❌");
         }
         return new Response('OK', { status: 200 });
      }

      // 3. DEFAULT COMMAND PARSING
      const res = await executeCommand(text, supabase, profile.store_id, profile.role, from);
      if (res.nextStep === 'awaiting_fiado_approval' && !res.responseText.includes('Bienvenido')) {
         // This means we have a complete list already!
         await sendWhatsAppMessage(from, generateVisualReceipt(res.metadata.customer, res.metadata.items));
         await supabase.from('registration_states').upsert({ whatsapp_number: from, step: res.nextStep, metadata: res.metadata });
      } else if (res.nextStep) {
         await supabase.from('registration_states').upsert({ whatsapp_number: from, step: res.nextStep, metadata: res.metadata });
         await sendWhatsAppMessage(from, res.responseText);
      } else {
         await sendWhatsAppMessage(from, res.responseText);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response('Error', { status: 200 });
  }
})
