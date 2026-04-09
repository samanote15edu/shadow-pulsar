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

async function sendWhatsAppButtons(to: string, bodyText: string, buttons: { id: string, title: string }[]) {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');

  await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    })
  });
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
    
    // Handle Button Replies (優先 ID) or Text
    let text = '';
    let isButtonYes = false;
    let isButtonNo = false;

    if (message.type === 'interactive') {
      const btnId = message.interactive.button_reply.id;
      text = message.interactive.button_reply.title;
      isButtonYes = (btnId === 'yes');
      isButtonNo = (btnId === 'no');
    } else {
      text = (message.text?.body || '').trim();
    }
      
    const normalized = normalizeText(text);

    // --- 1. BLOQUEO DE DUPLICADOS ---
    const { error: lockError } = await supabase
      .from('webhook_idempotency')
      .insert({ id: messageId, status: 'processing' });

    if (lockError) return new Response('OK', { status: 200 });

    await logDebug(from, 'message_received', { text, normalized, messageId, isButtonYes });

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

      // Respuestas genéricas de confirmación (Soportando Botones y Texto)
      const isPositive = isButtonYes || ['si', 's', 'yes', 'va', 'dale', 'ok', 'afirma', 'simon', 'sí', 'Si'].includes(normalized);
      const isNegative = isButtonNo || ['no', 'n', 'nel', 'nones', 'cancelar', 'cancel'].includes(normalized);
      const isExit = ['cancelar', 'salir', 'exit', 'cancel', 'reset', 'parar'].includes(normalized);

      await logDebug(from, 'state_processing', { step, isPositive, isNegative, isExit, normalized });

      // COMANDO GLOBAL: Salida de Emergencia (Reset)
      if (isExit) {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, "✅ Operación cancelada. ¿En qué más puedo ayudarte?");
        return new Response('OK', { status: 200 });
      }

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
          await sendWhatsAppButtons(from, "¿Confirmas la operación?", [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
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
          await sendWhatsAppButtons(from, "¿Es el mismo producto?", [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
          return new Response('OK', { status: 200 }); 
        }
      }

      // ESTADO: Confirmación de Ticket Masivo (Bulk Sale)
      else if (step === 'awaiting_bulk_confirmation') {
        if (isPositive) {
          const items = metadata.items;
          for (const item of items) {
             // Procesar cada venta individual de la lista
             await supabase.rpc('increment_stock', { row_id: item.productId, amount: -item.qty });
             await supabase.from('transactions').insert({
               store_id: profile.store_id,
               product_id: item.productId,
               type: 'sale',
               quantity_change: -item.qty,
               unit_price: item.price,
               total_amount: item.subtotal
             });
          }
          await sendWhatsAppMessage(from, `✅ *Venta Masiva Completada*\n\nSe registraron ${items.length} productos.\n*TOTAL: $${metadata.total}*`);
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Ticket cancelado. ❌");
        } else {
          await sendWhatsAppButtons(from, "¿Confirmas todo el ticket?", [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmación de Anulación (Void) - Lógica Robusta
      else if (step === 'awaiting_void_confirmation') {
        if (isPositive) {
          // 1. Mark original as voided
          await supabase.from('transactions').update({ is_voided: true }).eq('id', metadata.transactionId);
          
          // 2. Revert Stock
          await supabase.rpc('increment_stock', { row_id: metadata.productId, amount: metadata.qty });
          
          // 3. Create NEW reversal record
          await supabase.from('transactions').insert({ 
            store_id: profile.store_id,
            product_id: metadata.productId,
            type: 'void',
            quantity_change: metadata.qty,
            total_amount: metadata.total,
            notes: `Reversa via WhatsApp. ID: ${metadata.transactionId}`
          });

          await sendWhatsAppMessage(from, `✅ *Venta Anulada con Éxito*\n\nSe devolvieron ${metadata.qty} ${metadata.productName} al inventario.`);
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Anulación cancelada. La venta sigue activa. ⚠️");
        } else {
          await sendWhatsAppButtons(from, "¿Confirmas la anulación?", [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Conteo Físico e Inventario (Auditoría)
      else if (step === 'awaiting_physical_count') {
        const idx = metadata.currentIndex;
        const productsCount = metadata.productsIds.length;
        const currentProdId = metadata.productsIds[idx];
        const currentProdName = metadata.names[idx];
        const currentProdStock = metadata.stocks[idx];

        const isSkip = ['saltar', 'paso', 'skip', 'siguiente'].includes(normalized);
        const isFinish = ['fin', 'terminar', 'hecho', 'finalizar'].includes(normalized);
        const actualStock = parseFloat(text.replace(/[^0-9.]/g, ''));

        if (isFinish) {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "🏁 *CONTEO FINALIZADO*\n\nSesión de auditoría cerrada con éxito. Los resultados ya están en tu panel de control.");
          return new Response('OK', { status: 200 });
        }

        if (isSkip) {
          // No hacemos nada y pasamos al siguiente
        } else if (!isNaN(actualStock)) {
          const diff = actualStock - currentProdStock;
          
          // 1. Actualizar Stock Real
          await supabase.from('products').update({ current_stock: actualStock }).eq('id', currentProdId);

          // 2. Registrar Transacción de Corrección (si hay diferencia)
          if (diff !== 0) {
             await supabase.from('transactions').insert({
               store_id: profile.store_id,
               product_id: currentProdId,
               type: 'correction',
               quantity_change: diff,
               notes: `Ajuste por Conteo Físico. Sistema: ${currentProdStock}, Real: ${actualStock}`
             });
          }
        } else {
          await sendWhatsAppMessage(from, "❌ Envía un número para el stock real, 'Saltar' para omitir o 'Fin' para terminar.");
          return new Response('OK', { status: 200 });
        }

        // Pasar al siguiente producto
        const nextIdx = idx + 1;
        if (nextIdx < productsCount) {
          const nextName = metadata.names[nextIdx];
          const nextStock = metadata.stocks[nextIdx];
          await supabase.from('registration_states').update({ metadata: { ...metadata, currentIndex: nextIdx } }).eq('whatsapp_number', from);
          
          await sendWhatsAppButtons(from, `📍 *Siguiente: ${nextName}*\n(Producto ${nextIdx + 1}/${productsCount})\n📦 Sistema dice: *${nextStock}*\n\n¿Cuántos hay realmente?`, [
            { id: 'skip', title: 'SALTAR ⏭️' },
            { id: 'fin', title: 'FIN 🏁' }
          ]);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "🏁 *¡HAS TERMINADO!*\n\nAuditoría completada. Todo el inventario ha sido reconciliado.");
        }
      }

      // ESTADO: Corregir monto de pago (Retroactivo)
      else if (step === 'awaiting_correction_amount') {
        const received = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(received)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número de lo recibido en efectivo.");
          return new Response('OK', { status: 200 });
        }

        const debt = metadata.total - received;
        await supabase.from('transactions').update({ amount_received: received }).eq('id', metadata.transactionId);

        if (debt > 0) {
          await supabase.from('registration_states').update({ 
            step: 'awaiting_customer_assignment', 
            metadata: { ...metadata, debt } 
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `📝 *Venta Partida*\n\nRecibiste $${received}.\nFaltan *$${debt}* por cobrar.\n\n¿A nombre de quién registro esta deuda? (Escribe el nombre del cliente)`);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *¡Corregido!*\n\nLa venta de ${metadata.productName} se marcó como pagada totalmente ($${received}).`);
        }
      }

      // ESTADO: Selección de venta para auditar
      else if (step === 'awaiting_audit_selection') {
        const idx = parseInt(text, 10) - 1;
        const item = metadata.items[idx];

        if (!item) {
          await sendWhatsAppMessage(from, "❌ Selección inválida. Di el número de la lista o 'No' para cancelar.");
          return new Response('OK', { status: 200 });
        }

        const prodName = item.products?.name || 'Venta';
        await supabase.from('registration_states').update({ 
          step: 'awaiting_paid_amount', 
          metadata: { transactionId: item.id, total: item.total_amount, productName: prodName } 
        }).eq('whatsapp_number', from);

        await sendWhatsAppMessage(from, `🔎 *Auditando: ${prodName}* ($${item.total_amount})\n\n¿Cuánto se cobró realmente en efectivo?`);
      }

      // ESTADO: Captura de monto en auditoría
      else if (step === 'awaiting_paid_amount') {
        const received = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(received)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número.");
          return new Response('OK', { status: 200 });
        }

        const debt = metadata.total - received;
        await supabase.from('transactions').update({ amount_received: received }).eq('id', metadata.transactionId);

        if (debt > 0) {
          await supabase.from('registration_states').update({ 
            step: 'awaiting_customer_assignment', 
            metadata: { ...metadata, debt } 
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `📝 *Ajuste: $${debt} pendientes*\n\n¿Quién se llevó esto a fiado? (Escribe su nombre)`);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *Conciliado*\n\nVenta marcada como pagada ($${received}).`);
        }
      }

      // ESTADO: Asignación de deuda a cliente
      else if (step === 'awaiting_customer_assignment') {
        const name = text.trim();
        
        // 1. Buscar o crear cliente en Ledger
        let { data: ledger } = await supabase.from('fiado_ledgers').select('*').eq('store_id', profile.store_id).ilike('customer_name', name).maybeSingle();
        
        if (!ledger) {
          const { data: newLedger } = await supabase.from('fiado_ledgers').insert({
            store_id: profile.store_id,
            customer_name: name,
            current_balance: metadata.debt,
            notes: 'Creado desde auditoría'
          }).select().single();
          ledger = newLedger;
        } else {
          await supabase.from('fiado_ledgers').update({
            current_balance: ledger.current_balance + metadata.debt,
            last_update_at: new Date().toISOString()
          }).eq('id', ledger.id);
        }

        // 2. Vincular transacción
        await supabase.from('transactions').update({ customer_id: ledger.id }).eq('id', metadata.transactionId);

        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `🤝 *Deuda Registrada*\n\nCliente: ${name}\nMonto: $${metadata.debt}\n\nEl sistema ya está conciliado.`);
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
        // Use buttons if it's a confirmation next step
        if (['awaiting_similarity_confirmation', 'awaiting_confirmation', 'awaiting_bulk_confirmation', 'awaiting_void_confirmation'].includes(res.nextStep || '')) {
            await sendWhatsAppButtons(from, res.responseText, [
                { id: 'yes', title: 'SÍ ✅' },
                { id: 'no', title: 'NO ❌' }
            ]);
        } else {
            await sendWhatsAppMessage(from, res.responseText);
        }
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
