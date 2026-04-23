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
      let profile = null;
      let tokenData = null;

      // Intento 1: Perfil por ID directo
      try {
        const { data } = await supabase.from('profiles').select('id, whatsapp_number').eq('id', token).maybeSingle();
        profile = data;
      } catch (e) {}

      // Intento 2: Reporte por Token directo
      try {
        const { data } = await supabase.from('report_tokens').select('token, stores (profiles (whatsapp_number))').eq('token', token).maybeSingle();
        tokenData = data;
      } catch (e) {}

      const ownerNumber = profile?.whatsapp_number || (tokenData as any)?.stores?.profiles?.whatsapp_number;
      const table = profile ? 'profiles' : (tokenData ? 'report_tokens' : null);
      const idVal = profile ? profile.id : (tokenData ? tokenData.token : null);

      if (!ownerNumber || !table) throw new Error(`Acceso denegado p/ ID: ${token?.substring(0, 8)}`);

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      await supabase.from(table).update({ otp_code: otp, otp_expires_at: expiresAt.toISOString() }).eq(table === 'profiles' ? 'id' : 'token', idVal);

      await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: ownerNumber, type: 'text', text: { body: `🔐 Código: *${otp}*` } })
      });

      return new Response(JSON.stringify({ message: 'OK' }), { headers: corsHeaders });
    }

    // 2. VERIFICAR CÓDIGO
    if (action === 'verify-otp') {
      let entry = null;
      let table = '';
      let idCol = '';

      // Buscar en Profiles
      try {
        const { data } = await supabase.from('profiles').select('id, otp_code, otp_expires_at').eq('id', token).maybeSingle();
        if (data) { entry = data; table = 'profiles'; idCol = 'id'; }
      } catch (e) {}

      // Buscar en Tokens
      if (!entry) {
        try {
          const { data } = await supabase.from('report_tokens').select('token, otp_code, otp_expires_at').eq('token', token).maybeSingle();
          if (data) { entry = { id: data.token, ...data }; table = 'report_tokens'; idCol = 'token'; }
        } catch (e) {}
      }

      if (!entry) throw new Error(`ID Desconocido: ${token?.substring(0, 8)}`);
      if (entry.otp_code !== code) throw new Error('Código incorrecto');
      if (new Date(entry.otp_expires_at) < new Date()) throw new Error('Código expirado');

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
