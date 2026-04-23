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
    // 1. SOLICITAR CÓDIGO (Request OTP)
    if (action === 'request-otp') {
      const lower = token?.toLowerCase();
      const upper = token?.toUpperCase();
      let ownerNumber = '';
      let tableName = '';
      let usedId = token;

      // Buscar en Profiles
      const { data: profile } = await supabase.from('profiles').select('id, whatsapp_number')
        .or(`id.eq.${lower},id.eq.${upper}`)
        .maybeSingle();

      if (profile) {
        ownerNumber = profile.whatsapp_number;
        tableName = 'profiles';
        usedId = profile.id;
      } else {
        // Buscar en Tokens
        const { data: tokenData } = await supabase.from('report_tokens').select('token, stores (profiles (whatsapp_number))')
          .or(`token.eq.${token},token.eq.${lower},token.eq.${upper}`)
          .maybeSingle();
        
        if (tokenData) {
          ownerNumber = (tokenData as any)?.stores?.profiles?.whatsapp_number;
          tableName = 'report_tokens';
          usedId = tokenData.token;
        }
      }

      if (!ownerNumber || !tableName) throw new Error(`ID no encontrado: ${token?.substring(0, 8)}`);

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await supabase.from(tableName).update({ 
        otp_code: otp, 
        otp_expires_at: expiresAt.toISOString() 
      }).eq(tableName === 'profiles' ? 'id' : 'token', usedId);

      await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: ownerNumber,
          type: 'text',
          text: { body: `🔐 Código de acceso: *${otp}*` }
        })
      });

      return new Response(JSON.stringify({ message: 'Enviado' }), { headers: corsHeaders });
    }

    // 2. VERIFICAR CÓDIGO
    if (action === 'verify-otp') {
      const lowerToken = token?.toLowerCase();
      const upperToken = token?.toUpperCase();

      // Buscar en perfiles (probando ambas versiones de caja)
      let { data: entry } = await supabase.from('profiles').select('id, otp_code, otp_expires_at')
        .or(`id.eq.${lowerToken},id.eq.${upperToken}`)
        .maybeSingle();
      
      let table = 'profiles';
      let idCol = 'id';

      // Si no, buscar en report_tokens
      if (!entry) {
        const { data: tokEntry } = await supabase.from('report_tokens').select('token, otp_code, otp_expires_at')
          .or(`token.eq.${token},token.eq.${lowerToken},token.eq.${upperToken}`)
          .maybeSingle();
        if (tokEntry) {
          entry = { id: tokEntry.token, otp_code: tokEntry.otp_code, otp_expires_at: tokEntry.otp_expires_at };
          table = 'report_tokens';
          idCol = 'token';
        }
      }

      if (!entry) throw new Error(`ID no encontrado: ${token?.substring(0, 8)}`);
      
      if (entry.otp_code !== code) throw new Error('Código incorrecto');
      if (new Date(entry.otp_expires_at) < new Date()) throw new Error('Código expirado');

      const { error: updErr } = await supabase.from(table).update({ 
        otp_verified_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString() 
      }).eq(idCol, entry.id);

      if (updErr) throw new Error('Error al actualizar');

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
