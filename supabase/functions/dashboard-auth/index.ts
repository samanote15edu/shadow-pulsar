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
      // Buscar el token y el dueño de la tienda
      const { data: tokenData, error: tokenError } = await supabase
        .from('report_tokens')
        .select(`
          store_id,
          stores (
            owner_id,
            profiles (whatsapp_number)
          )
        `)
        .eq('token', token)
        .single();

      if (tokenError || !tokenData) throw new Error('Token de acceso inválido');

      const ownerNumber = (tokenData.stores as any)?.profiles?.whatsapp_number;
      if (!ownerNumber) throw new Error('No se encontró el número del dueño');

      // Generar código de 6 dígitos
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minutos de validez

      await supabase
        .from('report_tokens')
        .update({ 
          otp_code: otp, 
          otp_expires_at: expiresAt.toISOString() 
        })
        .eq('token', token);

      // Enviar por WhatsApp
      await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: ownerNumber,
          type: 'text',
          text: { body: `🔐 Tu código de acceso al Dashboard es: *${otp}*\n\nEste código vence en 5 minutos.` }
        })
      });

      return new Response(JSON.stringify({ message: 'Código enviado' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      });
    }

    // 2. VERIFICAR CÓDIGO (Verify OTP)
    if (action === 'verify-otp') {
      const { data: tokenData, error: tokenError } = await supabase
        .from('report_tokens')
        .select('*')
        .eq('token', token)
        .eq('otp_code', code)
        .single();

      if (tokenError || !tokenData) throw new Error('Código incorrecto');

      // Verificar expiración
      if (new Date(tokenData.otp_expires_at) < new Date()) {
        throw new Error('El código ha expirado. Pide uno nuevo.');
      }

      // Marcar como verificado
      await supabase
        .from('report_tokens')
        .update({ 
          otp_verified_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString() 
        })
        .eq('token', token);

      return new Response(JSON.stringify({ success: true }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      });
    }

    throw new Error('Acción no reconocida');

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    });
  }
})
