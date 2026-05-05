import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
import { handleCommand, executeCommand } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');

async function sendWhatsAppMessage(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
}

serve(async (req) => {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      if (url.searchParams.get('hub.verify_token') === 'shadow_pulsar_secret') {
        return new Response(url.searchParams.get('hub.challenge'));
      }
      return new Response("Invalid token", { status: 403 });
    }

    const payload = await req.json();
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message?.text?.body) {
      const from = message.from;
      const body = message.text.body;

      if (body.toLowerCase() === 'reset') {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, "🔄 Estado reseteado. Puedes empezar de nuevo con 'nueva tienda'.");
        return new Response("OK", { status: 200 });
      }

      // 1. Obtener Perfil
      let { data: profile } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).maybeSingle();
      if (!profile) {
        const { data: newUser } = await supabase.from('profiles').insert({ 
          whatsapp_number: from, 
          role: 'owner',
          full_name: 'Usuario'
        }).select().single();
        profile = newUser;
      }

      // 2. Obtener Estado Conversacional
      const { data: convState } = await supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle();

      // 3. Procesar Comando (Firma correcta)
      const convRes = await handleCommand(body, profile.store_id, supabase, profile.full_name || 'Amigo', convState);

      if (convRes && convRes.responseText) {
        const meta = convRes.metadata;

        // EJECUCIONES EN DB
        if (meta?.intent === 'CREATE_NEW_BRANCH') {
          // Hardcode de seguridad para el usuario principal
          const ownerId = (from === '5215513531114') ? 'cc04e6ce-7abf-4926-a3aa-f15166422e32' : profile?.id;
          
          const { data: newStore, error: storeError } = await supabase.from('stores').insert({
            name: meta.name,
            owner_id: ownerId,
            logo_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(meta.name)}`
          }).select().single();

          if (storeError) {
             await sendWhatsAppMessage(from, `❌ Error DB: ${storeError.message}`);
          } else if (newStore) {
             await supabase.from('profiles').update({ store_id: newStore.id }).eq('id', profile.id);
             // Enviamos el mensaje de éxito y la invitación a añadir el primer producto
             await sendWhatsAppMessage(from, `✅ ¡Sucursal *"${newStore.name}"* registrada!\n\n¿Te gustaría dar de alta tu primer producto? 📦`);
          }
        }

        if (!convRes.nextStep && meta?.intent === 'LINK_OWNER_CONFIRMED') {
          await supabase.from('stores').update({ owner_id: profile.id }).eq('id', meta.storeId);
          await supabase.from('profiles').update({ store_id: meta.storeId }).eq('id', profile.id);
          await sendWhatsAppMessage(from, `✅ Ahora eres el dueño oficial de *${meta.storeName}*.`);
        }

        // GUARDAR ESTADO PARA LA SIGUIENTE PREGUNTA
        if (convRes.nextStep) {
          await supabase.from('registration_states').upsert({ 
            whatsapp_number: from, 
            step: convRes.nextStep, 
            metadata: meta 
          });
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        }

        // ENVIAR RESPUESTA FINAL
        await sendWhatsAppMessage(from, convRes.responseText);
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("GLOBAL ERROR:", err.message);
    return new Response("Error", { status: 200 });
  }
});
