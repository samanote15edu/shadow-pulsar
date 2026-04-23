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
      const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();

      await supabase.from(table).update({ otp_code: otp, otp_expires_at: expiresAt }).eq(table === 'profiles' ? 'id' : 'token', idVal);

      await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: ownerNumber, type: 'text', text: { body: `🔐 Código: *${otp}*` } })
      });

      return new Response(JSON.stringify({ message: 'OK' }), { headers: corsHeaders });
    }

    // 2. VERIFICAR CÓDIGO
    if (action === 'verify-otp') {
      // Intento A: Por ID (el más seguro)
      let { data: entry } = await supabase.from('profiles').select('id, otp_code, otp_expires_at').or(`id.eq.${token},id.ilike.${token}%`).maybeSingle();
      let table = 'profiles';
      let idCol = 'id';

      if (!entry) {
        const { data: t } = await supabase.from('report_tokens').select('token, otp_code, otp_expires_at').or(`token.eq.${token},token.ilike.${token}%`).maybeSingle();
        if (t) { entry = { id: t.token, ...t }; table = 'report_tokens'; idCol = 'token'; }
      }

      // Intento B (EMERGENCIA): Buscar cualquier registro que tenga ese CÓDIGO y no haya expirado
      if (!entry) {
        const { data: emergencyProfile } = await supabase.from('profiles').select('id, otp_code, otp_expires_at').eq('otp_code', code).gt('otp_expires_at', new Date().toISOString()).maybeSingle();
        if (emergencyProfile) { entry = emergencyProfile; table = 'profiles'; idCol = 'id'; }
      }

      if (!entry) throw new Error(`Código no hallado en sistema (${token?.substring(0, 8)})`);
      
      if (entry.otp_code !== code) throw new Error('Código incorrecto');
      if (new Date(entry.otp_expires_at) < new Date()) throw new Error('Código ya venció');

      await supabase.from(table).update({ 
        otp_verified_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString() 
      }).eq(idCol, entry.id);

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    throw new Error('Acción no reconocida');

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
})
