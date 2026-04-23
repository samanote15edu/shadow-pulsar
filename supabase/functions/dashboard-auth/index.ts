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
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
      let ownerNumber = '';
      let tableName = '';

      if (isUUID) {
        const { data: profile } = await supabase.from('profiles').select('whatsapp_number').eq('id', token).maybeSingle();
        if (profile) {
          ownerNumber = profile.whatsapp_number;
          tableName = 'profiles';
        }
      } 
      
      if (!tableName) {
        const { data: tokenData } = await supabase
          .from('report_tokens')
          .select('token, stores (profiles (whatsapp_number))')
          .eq('token', token)
          .maybeSingle();
        
        if (tokenData) {
          ownerNumber = (tokenData as any)?.stores?.profiles?.whatsapp_number;
          tableName = 'report_tokens';
        }
      }

      if (!ownerNumber || !tableName) throw new Error('Acceso no encontrado');

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await supabase
        .from(tableName)
        .update({ 
          otp_code: otp, 
          otp_expires_at: expiresAt.toISOString() 
        })
        .eq(tableName === 'profiles' ? 'id' : 'token', token);

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
      // Intentar encontrar el registro en Profiles
      let { data: entry } = await supabase.from('profiles').select('id, otp_code, otp_expires_at').eq('id', token).maybeSingle();
      let table = 'profiles';
      let idCol = 'id';

      // Si no está en Profiles, buscar en Report Tokens
      if (!entry) {
        const { data: reportEntry } = await supabase.from('report_tokens').select('token, otp_code, otp_expires_at').eq('token', token).maybeSingle();
        if (reportEntry) {
          entry = { id: reportEntry.token, otp_code: reportEntry.otp_code, otp_expires_at: reportEntry.otp_expires_at };
          table = 'report_tokens';
          idCol = 'token';
        }
      }

      if (!entry) throw new Error('No se encontró registro para este ID');
      
      // Comparación manual (más robusta)
      if (entry.otp_code !== code) {
        throw new Error(`Código incorrecto`);
      }

      if (new Date(entry.otp_expires_at) < new Date()) {
        throw new Error('Código expirado');
      }

      // Guardar verificación
      const { error: updError } = await supabase.from(table).update({ 
        otp_verified_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString() 
      }).eq(idCol, token);

      if (updError) throw new Error('Error al guardar verificación');

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
