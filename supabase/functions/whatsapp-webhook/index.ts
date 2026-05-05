import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

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
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      if (url.searchParams.get('hub.verify_token') === 'shadow_pulsar_secret') {
        return new Response(url.searchParams.get('hub.challenge'));
      }
      return new Response("Invalid token", { status: 403 });
    }

    const payload = await req.json();
    const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message?.text?.body) {
      const from = message.from;
      const body = message.text.body.trim();

      // MODO RESCATE: Si el usuario escribe "CREAR [NOMBRE]"
      if (body.toLowerCase().startsWith('crear ')) {
        const storeName = body.substring(6);
        const ownerId = (from === '5215513531114') ? 'cc04e6ce-7abf-4926-a3aa-f15166422e32' : null;
        
        if (!ownerId) {
          await sendWhatsAppMessage(from, "❌ No tienes permiso para usar el comando de rescate.");
          return new Response("Unauthorized", { status: 200 });
        }

        await sendWhatsAppMessage(from, `🛠️ Intentando crear tienda: "${storeName}"...`);
        
        const { data: store, error: sErr } = await supabase.from('stores').insert({
          name: storeName,
          owner_id: ownerId
        }).select().single();

        if (sErr) {
          await sendWhatsAppMessage(from, `❌ Error DB: ${sErr.message}`);
        } else {
          await sendWhatsAppMessage(from, `✅ ¡EXITO TOTAL! Tienda "${store.name}" creada. ID: ${store.id}\nRefresca tu dashboard.`);
        }
        return new Response("OK", { status: 200 });
      }

      // Si no es comando de rescate, intentar cargar el parser normal
      try {
        const { handleCommand } = await import('./parser.ts');
        let { data: profile } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).single();
        const result = await handleCommand(body, profile || { whatsapp_number: from });
        if (result.responseText) await sendWhatsAppMessage(from, result.responseText);
      } catch (e) {
        await sendWhatsAppMessage(from, "🤖 El sistema principal está en mantenimiento. Usa: 'CREAR [nombre]' para emergencias.");
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response("Internal Error", { status: 200 });
  }
});
