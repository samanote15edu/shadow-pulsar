import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
  const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { action, token, code } = await req.json();

  try {
    // 1. SOLICITAR CÓDIGO
    if (action === 'request-otp') {
      const { data: profile } = await supabase.from('profiles').select('id, whatsapp_number').or(`id.eq.${token},id.ilike.${token}%`).maybeSingle();
      const { data: tokenData } = await supabase.from('report_tokens').select('token, stores (profiles (whatsapp_number))').or(`token.eq.${token},token.ilike.${token}%`).maybeSingle();

      const ownerNumber = profile?.whatsapp_number || (tokenData as any)?.stores?.profiles?.whatsapp_number;
      const table = profile ? 'profiles' : (tokenData ? 'report_tokens' : null);
      const idVal = profile ? profile.id : (tokenData ? tokenData.token : null);

      if (!ownerNumber || !table) throw new Error(`Sin acceso para: ${token?.substring(0, 8)}`);

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();

      const { error: saveError } = await supabase.from(table).update({ 
        otp_code: otp, 
        otp_expires_at: expiresAt 
      }).eq(table === 'profiles' ? 'id' : 'token', idVal);

      if (saveError) {
        throw new Error(`Error al guardar en BD: ${saveError.message} (Tabla: ${table})`);
      }

      const waRes = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: ownerNumber, type: 'text', text: { body: `🔐 Código: *${otp}*` } })
      });

      if (!waRes.ok) {
        const waErr = await waRes.json();
        throw new Error(`Error WhatsApp: ${waErr.error?.message || 'Desconocido'}`);
      }

      return new Response(JSON.stringify({ message: 'OK' }), { headers: corsHeaders });
    }

    // 2. VERIFICAR CÓDIGO
    if (action === 'verify-otp') {
      // Búsqueda AGRESIVA: No nos importa el ID, buscamos cualquier registro con ese código que no haya vencido
      const now = new Date().toISOString();
      
      // 1. Probar en Profiles
      const { data: p } = await supabase.from('profiles').select('id, otp_code, otp_expires_at').eq('otp_code', code).gt('otp_expires_at', now).maybeSingle();
      
      // 2. Probar en Report Tokens (si no se halló en profiles)
      let t = null;
      if (!p) {
        const { data: tokData } = await supabase.from('report_tokens').select('token, otp_code, otp_expires_at').eq('otp_code', code).gt('otp_expires_at', now).maybeSingle();
        t = tokData;
      }

      const entry = p || t;
      const table = p ? 'profiles' : 'report_tokens';
      const idCol = p ? 'id' : 'token';
      const realId = p ? p.id : t?.token;

      if (!entry) throw new Error(`Código ${code} no hallado o vencido`);
      
      await supabase.from(table).update({ 
        otp_verified_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString() 
      }).eq(idCol, realId);

      return new Response(JSON.stringify({ success: true, table_used: table }), { headers: corsHeaders });
    }

    throw new Error('Acción no reconocida');

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
})
