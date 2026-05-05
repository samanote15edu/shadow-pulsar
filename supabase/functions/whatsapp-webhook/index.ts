import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
import { handleCommand } from './parser.ts';

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

serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (url.searchParams.get('hub.verify_token') === 'shadow_pulsar_secret') {
      return new Response(url.searchParams.get('hub.challenge'));
    }
    return new Response("Invalid token", { status: 403 });
  }

  try {
    const payload = await req.json();
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message?.text?.body) {
      const from = message.from;
      const body = message.text.body;

      // 1. Obtener perfil
      let { data: profile } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).single();
      
      if (!profile) {
        const { data: newUser } = await supabase.from('profiles').insert({ 
          whatsapp_number: from, 
          role: 'owner' 
        }).select().single();
        profile = newUser;
      }

      // 2. Procesar comando vía Parser
      const result = await handleCommand(body, profile);
      
      // 3. Lógica Especial: Creación de Tienda (Onboarding)
      if (result.metadata?.intent === 'CREATE_NEW_BRANCH' && !result.nextStep) {
        // Garantizamos el owner_id: Prioridad a Auth ID, fallback a Profile ID
        const ownerId = profile.id; 
        
        const { data: store, error: storeError } = await supabase.from('stores').insert({
          name: result.metadata.name,
          owner_id: ownerId
        }).select().single();

        if (storeError) {
          await sendWhatsAppMessage(from, `❌ Error al crear tienda: ${storeError.message}`);
        } else {
          // Vincular perfil a la nueva tienda
          await supabase.from('profiles').update({ store_id: store.id }).eq('id', profile.id);
          await sendWhatsAppMessage(from, `✅ ¡Sucursal *"${store.name}"* registrada y vinculada con éxito!`);
        }
      } 
      // 4. Lógica Especial: Vinculación Manual
      else if (result.metadata?.intent === 'LINK_OWNER_CONFIRMED') {
        const { error: linkError } = await supabase.from('stores')
          .update({ owner_id: profile.id })
          .eq('id', result.metadata.storeId);

        if (linkError) {
          await sendWhatsAppMessage(from, `❌ Error al vincular: ${linkError.message}`);
        } else {
          await supabase.from('profiles').update({ store_id: result.metadata.storeId }).eq('id', profile.id);
          await sendWhatsAppMessage(from, `✅ Ahora eres el dueño oficial de *${result.metadata.storeName}*.`);
        }
      }
      // 5. Respuesta Estándar
      else if (result.responseText) {
        await sendWhatsAppMessage(from, result.responseText);
      }
    }
  } catch (err) {
    console.error("Webhook Error:", err);
  }

  return new Response("OK", { status: 200 });
});
