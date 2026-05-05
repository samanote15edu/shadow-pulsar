import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
// Importación con ruta completa para Deno
import { handleCommand } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendWhatsAppMessage(to: string, text: string) {
  try {
    const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
    const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
    await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
    });
  } catch (e) {
    console.error("WhatsApp Send Error:", e);
  }
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
      const result = await handleCommand(body, profile || { whatsapp_number: from });
      
      // 3. Lógica Especial: Creación de Tienda
      if (result.metadata?.intent === 'CREATE_NEW_BRANCH' && !result.nextStep) {
        const ownerId = (from === '5215513531114') ? 'cc04e6ce-7abf-4926-a3aa-f15166422e32' : profile?.id; 
        
        const { data: store, error: storeError } = await supabase.from('stores').insert({
          name: result.metadata.name,
          owner_id: ownerId
        }).select().single();

        if (storeError) {
          await sendWhatsAppMessage(from, `❌ Error DB: ${storeError.message}`);
        } else {
          if (profile?.id) {
            await supabase.from('profiles').update({ store_id: store.id }).eq('id', profile.id);
          }
          await sendWhatsAppMessage(from, `✅ ¡Sucursal *"${store.name}"* registrada y vinculada!`);
        }
      } 
      // 4. Respuesta Estándar
      else if (result.responseText) {
        await sendWhatsAppMessage(from, result.responseText);
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    // Si hay un error, al menos intentamos avisar por consola de Supabase
    console.error("CRITICAL ERROR:", err.message);
    return new Response("Internal Error", { status: 200 });
  }
});
