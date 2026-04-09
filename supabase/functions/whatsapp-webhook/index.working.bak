import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

// --- CONFIGURACIÓN ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

import { executeCommand } from './parser.ts';

// --- CONFIGURACIÓN ENVÍO ---
async function sendWhatsAppMessage(to: string, text: string) {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- SERVIDOR PRINCIPAL ---
// --- UTILIDADES ---
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Quitar acentos
}

// Registro de depuración en la base de datos
async function logDebug(phone: string, action: string, payload: any) {
  await supabase.from('debug_logs').insert({ 
    payload: { phone, action, ...payload },
    created_at: new Date().toISOString()
  });
}

// --- SERVIDOR PRINCIPAL ---
serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    return new Response(url.searchParams.get('hub.challenge'), { status: 200 });
  }

  try {
    const body = await req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return new Response('OK', { status: 200 });

    const from = message.from;
    const messageId = message.id; 
    const text = (message.text?.body || '').trim();
    const normalized = normalizeText(text);

    // --- 1. BLOQUEO DE DUPLICADOS ---
    const { error: lockError } = await supabase
      .from('webhook_idempotency')
      .insert({ id: messageId, status: 'processing' });

    if (lockError) return new Response('OK', { status: 200 });

    await logDebug(from, 'message_received', { text, normalized, messageId });

    // --- 2. CONSULTAS DE CONTEXTO ---
    const [profileRes, stateRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('whatsapp_number', from).maybeSingle(),
      supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle()
    ]);

    const profile = profileRes.data;
    const state = stateRes.data;

    await logDebug(from, 'context_check', { hasProfile: !!profile, state: state?.step || 'none' });

    // --- 3. LOGICA PRINCIPAL ---

    // A. FLUJO DE CONVERSACIÓN ACTIVA (ESTADOS) - Prioridad Máxima
    if (state) {
      const { step, metadata } = state;

      // Respuestas genéricas de confirmación
      const isPositive = ['si', 's', 'yes', 'va', 'dale', 'ok', 'afirma', 'simon', 'sí', 'Si'].includes(normalized) || normalized === 'si';
      const isNegative = ['no', 'n', 'nel', 'nones', 'cancelar', 'cancel'].includes(normalized);

      await logDebug(from, 'state_processing', { step, isPositive, isNegative, normalized });

      // ESTADO: Registro de Tienda (Onboarding)
      if (step === 'awaiting_store_name') {
        await supabase.from('registration_states').update({ step: 'awaiting_owner_name', metadata: { store_name: text } }).eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `Entendido. Último paso:\n\n¿Cuál es tu nombre completo? (Dueño)`);
      } 
      else if (step === 'awaiting_owner_name') {
        const { data: newStore } = await supabase.from('stores').insert({ name: metadata.store_name }).select().single();
        await supabase.from('profiles').insert({ whatsapp_number: from, full_name: text, role: 'owner', store_id: newStore.id });
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `¡Felicidades *${text}*! 🚀 Tu tienda *${metadata.store_name}* ya está registrada.`);
      }
      
      // ESTADO: Costo de Producto (Surtido Existente)
      else if (step === 'awaiting_product_cost') {
        const cost = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(cost)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número del costo (ej: 12.50)");
        } else {
          await supabase.from('products').update({ last_cost_price: cost }).eq('id', metadata.productId);
          await supabase.rpc('increment_stock', { row_id: metadata.productId, amount: metadata.qty });
          await supabase.from('transactions').insert({
            store_id: profile.store_id,
            product_id: metadata.productId,
            type: 'restock',
            quantity_change: metadata.qty,
            unit_price: cost,
            total_amount: cost * metadata.qty
          });
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *Surtido Completado*\n\nProducto: ${metadata.productName}\nNuevo Costo: $${cost}\nCantidad: +${metadata.qty}`);
        }
      }

      // ESTADO: Detalles de Producto Nuevo (Costo y Venta)
      else if (step === 'awaiting_new_product_details') {
        const prices = text.match(/\d+(\.\d+)?/g);
        if (!prices || prices.length < 2) {
          await sendWhatsAppMessage(from, "❌ Necesito los 2 precios (Costo y Venta). Ejemplo: '10 y 15'");
        } else {
          const cost = parseFloat(prices[0]);
          const sale = parseFloat(prices[1]);
          const { data: prod } = await supabase.from('products').insert({
            store_id: profile.store_id,
            name: metadata.productName,
            base_price: sale,
            last_cost_price: cost,
            current_stock: metadata.qty
          }).select().single();
          await supabase.from('transactions').insert({
            store_id: profile.store_id,
            product_id: prod.id,
            type: 'restock',
            quantity_change: metadata.qty,
            unit_price: cost,
            total_amount: cost * metadata.qty
          });
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *¡Producto Registrado!*\n\n${prod.name}\nCosto: $${cost}\nVenta: $${sale}\nStock: ${metadata.qty}`);
        }
      }

      // ESTADO: Confirmación Genérica (Ventas, etc)
      else if (step === 'awaiting_confirmation') {
        if (isPositive) {
          if (metadata.type === 'sale') {
            await supabase.rpc('increment_stock', { row_id: metadata.productId, amount: -metadata.qty });
            await supabase.from('transactions').insert({
              store_id: profile.store_id, product_id: metadata.productId, type: 'sale',
              quantity_change: -metadata.qty, unit_price: metadata.price, total_amount: metadata.total
            });
            await sendWhatsAppMessage(from, `✅ *Venta Registrada*\n\nProducto: ${metadata.productName}\nTotal: $${metadata.total}`);
          }
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Operación cancelada. ❌");
        } else {
          await sendWhatsAppMessage(from, "¿Confirmas la operación? Responde *SÍ* o *NO*.");
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmación de Similitud (Fuzzy Search)
      else if (step === 'awaiting_similarity_confirmation') {
        if (isPositive) {
          await supabase.from('registration_states').update({
            step: 'awaiting_product_cost',
            metadata: { productId: metadata.productId, qty: metadata.qty, productName: metadata.productName }
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `📦 *Surtido: ${metadata.productName}*\n\n¿Cuánto te costó cada unidad esta vez?`);
        } else if (isNegative) {
          await supabase.from('registration_states').update({
            step: 'awaiting_new_product_details',
            metadata: { productName: metadata.newName, qty: metadata.qty }
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✨ *¡Nuevo Producto!* ✨\n\nRegistraremos "${metadata.newName}" por separado.\n\nPor favor, dime:\n1. ¿Cuánto te costó?\n2. ¿A cuánto lo venderás?`);
        } else {
          await logDebug(from, 'similarity_failed_match', { normalized, text });
          await sendWhatsAppMessage(from, "¿Es el mismo producto? Responde *SÍ* para unificar o *NO* para crear uno nuevo.");
          return new Response('OK', { status: 200 }); 
        }
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // B. COMANDOS NUEVOS (Si ya tiene perfil)
    if (profile) {
      const res = await executeCommand(text, supabase, profile.store_id, profile.role, from);
      if (res.nextStep) {
        const { error: upsertError } = await supabase.from('registration_states').upsert({ whatsapp_number: from, step: res.nextStep, metadata: res.metadata });
        await logDebug(from, 'state_saved', { step: res.nextStep, error: upsertError });
      }
      if (res.responseText) {
        await sendWhatsAppMessage(from, res.responseText);
      }
      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // C. CÓDIGO INICIAL
    if (normalized === 'tiendita2026') {
      await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_store_name' });
      await sendWhatsAppMessage(from, "¡Código aceptado! ✅\n\n¿Cómo se llama tu negocio?");
    }

    await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[CRITICAL ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
