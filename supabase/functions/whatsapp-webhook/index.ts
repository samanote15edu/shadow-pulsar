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
    
    // Handle Button Replies
    let text = '';
    let isButtonYes = false;
    let isButtonNo = false;
    let buttonId = '';

    if (message.type === 'interactive') {
      buttonId = message.interactive.button_reply.id;
      text = message.interactive.button_reply.title;
      isButtonYes = (buttonId === 'yes' || buttonId === 'full');
      isButtonNo = (buttonId === 'no' || buttonId === 'partial');
    } else {
      text = (message.text?.body || '').trim();
    }
      
    const normalized = normalizeText(text);

    // --- 1. BLOQUEO DE DUPLICADOS ---
    const { error: lockError } = await supabase
      .from('webhook_idempotency')
      .insert({ id: messageId, status: 'processing' });

    if (lockError) return new Response('OK', { status: 200 });

    await logDebug(from, 'message_received', { text, normalized, messageId, buttonId });

    // --- 2. CONSULTAS DE CONTEXTO ---
    const [profileRes, stateRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('whatsapp_number', from).maybeSingle(),
      supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle()
    ]);

    const profile = profileRes.data;
    const state = stateRes.data;

    await logDebug(from, 'context_check', { hasProfile: !!profile, state: state?.step || 'none' });

    // --- 3. LOGICA PRINCIPAL ---

    // A. FLUJO DE CONVERSACIÓN ACTIVA (ESTADOS)
    if (state) {
      const { step, metadata } = state;

      const isPositive = isButtonYes || ['si', 's', 'yes', 'va', 'dale', 'ok', 'afirma', 'simon', 'sí', 'si', 'pago completo'].some(k => normalized === k || normalized.includes('completo'));
      const isNegative = isButtonNo || ['no', 'n', 'nel', 'nones', 'cancelar', 'cancel', 'pago parcial', 'fiado'].some(k => normalized === k || normalized.includes('parcial'));
      const isExit = ['cancelar', 'salir', 'exit', 'cancel', 'reset', 'parar'].includes(normalized);

      if (isExit) {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, "✅ Operación cancelada. ¿En qué más puedo ayudarte?");
        return new Response('OK', { status: 200 });
      }

      // ESTADO: Registro de Tienda
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
      
      // ESTADO: Costo de Producto
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

      // ESTADO: Detalles de Producto Nuevo
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

      // ESTADO: Confirmación de Ticket (Individual)
      else if (step === 'awaiting_confirmation') {
        if (isPositive) {
          if (metadata.type === 'sale') {
            await supabase.rpc('increment_stock', { row_id: metadata.productId, amount: -metadata.qty });
            const { data: tx } = await supabase.from('transactions').insert({
              store_id: profile.store_id, product_id: metadata.productId, type: 'sale',
              quantity_change: -metadata.qty, unit_price: metadata.price, total_amount: metadata.total
            }).select().single();

            await supabase.from('registration_states').update({ 
               step: 'awaiting_payment_confirmation', 
               metadata: { ...metadata, transactionIds: [{ id: tx.id, total: metadata.total }] } 
            }).eq('whatsapp_number', from);
            
            await sendWhatsAppButtons(from, `📦 *Venta Guardada*\n\nTotal: $${metadata.total}\n\n¿Deseas registrar el pago ahora?`, [
                { id: 'full', title: 'PAGO COMPLETO ✅' },
                { id: 'partial', title: 'PAGO PARCIAL/FIADO 📝' }
            ]);
            return new Response('OK', { status: 200 });
          }
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Operación cancelada. ❌");
        } else {
          await sendWhatsAppButtons(from, "¿Confirmas la operación?", [{ id: 'yes', title: 'SÍ ✅' }, { id: 'no', title: 'NO ❌' }]);
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmación de Ticket Masivo
      else if (step === 'awaiting_bulk_confirmation') {
        if (isPositive) {
          const transactionIds = [];
          for (const item of metadata.items) {
             await supabase.rpc('increment_stock', { row_id: item.productId, amount: -item.qty });
             const { data: tx } = await supabase.from('transactions').insert({
               store_id: profile.store_id, product_id: item.productId, type: 'sale',
               quantity_change: -item.qty, unit_price: item.price, total_amount: item.subtotal
             }).select().single();
             if (tx) transactionIds.push({ id: tx.id, total: item.subtotal });
          }
          
          await supabase.from('registration_states').update({ 
            step: 'awaiting_payment_confirmation', 
            metadata: { ...metadata, transactionIds } 
          }).eq('whatsapp_number', from);

          await sendWhatsAppButtons(from, `🥤 *Ticket Guardado*\n\nTotal: $${metadata.total}\n\n¿Cómo se realizó el pago?`, [
            { id: 'full', title: 'PAGO COMPLETO ✅' },
            { id: 'partial', title: 'PAGO PARCIAL/FIADO 📝' }
          ]);
          return new Response('OK', { status: 200 });
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Ticket cancelado. ❌");
        } else {
          await sendWhatsAppButtons(from, "¿Confirmas todo el ticket?", [{ id: 'yes', title: 'SÍ ✅' }, { id: 'no', title: 'NO ❌' }]);
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmación de Pago (NUEVO)
      else if (step === 'awaiting_payment_confirmation') {
        if (isPositive) {
          const items = metadata.transactionIds;
          for (const item of items) {
             await supabase.from('transactions').update({ amount_received: item.total }).eq('id', item.id);
          }
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *Pago Completo Registrado*\n\nVenta cerrada con éxito.`);

          // CHEQUEO FINAL DE STOCK (Tras pago completo)
          const idsToCheck = items.map(it => it.id);
          const { data: finalTxs } = await supabase.from('transactions').select('product_id, products(name, current_stock)').in('id', idsToCheck);
          
          if (finalTxs) {
            for (const tx of finalTxs) {
              const prod = (tx as any).products;
              if (prod && prod.current_stock < 0) {
                await sendWhatsAppMessage(from, `⚠️ *ALERTA:* El stock de *${prod.name}* quedó en ${prod.current_stock}.\n\n¿Deseas registrar un *surtido* ahora? Escribe la cantidad recibida (ej: 20) o escribe "No".`);
                // Guardamos el estado para el surtido inmediato
                await supabase.from('registration_states').upsert({ 
                  whatsapp_number: from, 
                  step: 'awaiting_product_cost', 
                  metadata: { productId: tx.product_id, qty: Math.abs(prod.current_stock), productName: prod.name } 
                });
                break; // Solo sugerimos uno a la vez para no confundir el flujo
              }
            }
          }
        } else if (isNegative) {
          await supabase.from('registration_states').update({ 
            step: 'awaiting_paid_amount',
            metadata: { ...metadata } 
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `💰 *Pago Parcial*\n\n¿Cuánto recibiste en efectivo?`);
        } else {
          await sendWhatsAppButtons(from, "¿Cómo fue el pago?", [
            { id: 'full', title: 'PAGO COMPLETO ✅' },
            { id: 'partial', title: 'PAGO PARCIAL/FIADO 📝' }
          ]);
        }
      }

      // ESTADO: Captura de monto (Usado en el flujo de Pago Parcial y Auditoría)
      else if (step === 'awaiting_paid_amount') {
        const received = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(received)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número.");
          return new Response('OK', { status: 200 });
        }

        const totalTicket = metadata.total;
        const debt = totalTicket - received;
        const items = metadata.transactionIds;

        // Repartir proporcionalmente el monto recibido entre los items
        for (const item of items) {
          const proportionalReceived = (item.total / totalTicket) * received;
          await supabase.from('transactions').update({ amount_received: proportionalReceived }).eq('id', item.id);
        }

        if (debt > 0) {
          await supabase.from('registration_states').update({ 
            step: 'awaiting_customer_assignment', 
            metadata: { ...metadata, debt } 
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `📝 *Ajuste: $${debt.toFixed(2)} pendientes*\n\n¿A quién le anotamos esta deuda? (Escribe su nombre)`);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *Pago Registrado*\n\nLa venta se marcó como pagada totalmente.`);
        }
      }

      // ESTADO: Deuda retroactiva (Corregir)
      else if (step === 'awaiting_correction_amount') {
        const received = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(received)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número.");
          return new Response('OK', { status: 200 });
        }
        const debt = metadata.total - received;
        await supabase.from('transactions').update({ amount_received: received }).eq('id', metadata.transactionId);
        if (debt > 0) {
          await supabase.from('registration_states').update({ step: 'awaiting_customer_assignment', metadata: { ...metadata, debt } }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `📝 *Pendiente de Cobro: $${debt}*\n\n¿A nombre de quién registramos el fiado?`);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✅ *¡Listo!*\n\nVenta actualizada.`);
        }
      }

      // SIGUIENTES ESTADOS (Auditoría, Similitud, Anulación, Ledger)
      // ... manteniendo el resto de la lógica ...
      else if (step === 'awaiting_similarity_confirmation') { /* ya manejada arriba */ }
      else if (step === 'awaiting_void_confirmation') {
          if (isPositive) {
            await supabase.from('transactions').update({ is_voided: true }).eq('id', metadata.transactionId);
            await supabase.rpc('increment_stock', { row_id: metadata.productId, amount: metadata.qty });
            await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: metadata.productId, type: 'void', quantity_change: metadata.qty, total_amount: metadata.total, notes: `Reversa ID: ${metadata.transactionId}` });
            await sendWhatsAppMessage(from, `✅ *Venta Anulada*`);
          } else { await sendWhatsAppMessage(from, "Cancelado."); }
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }
      else if (step === 'awaiting_physical_count') {
          const idx = metadata.currentIndex;
          if (normalized === 'fin') {
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, "🏁 Conteo finalizado.");
          } else {
            const actual = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (!isNaN(actual)) {
              await supabase.from('products').update({ current_stock: actual }).eq('id', metadata.productsIds[idx]);
              const diff = actual - metadata.stocks[idx];
              if (diff !== 0) await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: metadata.productsIds[idx], type: 'correction', quantity_change: diff, notes: 'Auditoría' });
            }
            const nextIdx = idx + 1;
            if (nextIdx < metadata.productsIds.length) {
              const nextName = metadata.names[nextIdx];
              await supabase.from('registration_states').update({ metadata: { ...metadata, currentIndex: nextIdx } }).eq('whatsapp_number', from);
              await sendWhatsAppMessage(from, `*Producto: ${nextName}*\n¿Cuántos hay?`);
            } else {
              await supabase.from('registration_states').delete().eq('whatsapp_number', from);
              await sendWhatsAppMessage(from, "🏁 Auditoría terminada.");
            }
          }
      }
      else if (step === 'awaiting_audit_selection') {
          const idx = parseInt(text, 10) - 1;
          const item = metadata.items[idx];
          if (item) {
            await supabase.from('registration_states').update({ step: 'awaiting_paid_amount', metadata: { transactionId: item.id, total: item.total_amount } }).eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `Auditando venta de $${item.total_amount}. ¿Cuánto se cobró?`);
          } else { await sendWhatsAppMessage(from, "Inválido."); }
      }
      else if (step === 'awaiting_customer_assignment') {
          const name = text.trim();
          let { data: ledger } = await supabase.from('fiado_ledgers').select('*').eq('store_id', profile.store_id).ilike('customer_name', name).maybeSingle();
          if (!ledger) {
            const { data: newL } = await supabase.from('fiado_ledgers').insert({ store_id: profile.store_id, customer_name: name, current_balance: metadata.debt }).select().single();
            ledger = newL;
          } else {
            await supabase.from('fiado_ledgers').update({ current_balance: ledger.current_balance + metadata.debt, last_update_at: new Date().toISOString() }).eq('id', ledger.id);
          }
          
          // Vincular todas las transacciones del ticket al deudor
          const txIds = metadata.transactionIds.map(t => t.id);
          await supabase.from('transactions').update({ customer_id: ledger.id }).in('id', txIds);
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `🤝 Deuda registrada a ${name}.`);

          // CHEQUEO FINAL DE STOCK (Tras registro de deuda)
          const { data: finalTxs } = await supabase.from('transactions').select('product_id, products(name, current_stock)').in('id', txIds);
          if (finalTxs) {
            for (const tx of finalTxs) {
              const prod = (tx as any).products;
              if (prod && prod.current_stock < 0) {
                await sendWhatsAppMessage(from, `⚠️ *ALERTA:* Tras la deuda de ${name}, el stock de *${prod.name}* quedó en ${prod.current_stock}.\n\n¿Deseas registrar un *surtido* ahora? Escribe la cantidad recibida o responde "No".`);
                await supabase.from('registration_states').upsert({ 
                  whatsapp_number: from, 
                  step: 'awaiting_product_cost', 
                  metadata: { productId: tx.product_id, qty: 10, productName: prod.name } // Default 10 if we don't know
                });
                break;
              }
            }
          }
      }

      // ESTADO: Captura de efectivo físico (Corte Ciego)
      else if (step === 'awaiting_physical_cash') {
        const physical = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(physical)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número del efectivo que tienes.");
          return new Response('OK', { status: 200 });
        }

        // Obtener último cierre
        let sinceTimestamp = '1970-01-01T00:00:00Z';
        const { data: lastCorte } = await supabase
          .from('cash_snapshots')
          .select('closed_at')
          .eq('store_id', profile.store_id)
          .order('closed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (lastCorte) sinceTimestamp = lastCorte.closed_at;

        // Calcular efectivo esperado (suma de todos los amount_received desde el último corte)
        const { data: txs } = await supabase
          .from('transactions')
          .select('amount_received')
          .eq('store_id', profile.store_id)
          .gt('created_at', sinceTimestamp)
          .is('is_voided', false);
        
        const expected = txs?.reduce((sum, tx) => sum + (Number(tx.amount_received) || 0), 0) || 0;
        const diff = physical - expected;

        await supabase.from('registration_states').update({
          step: 'awaiting_corte_confirmation',
          metadata: { physical, expected, diff, since: sinceTimestamp }
        }).eq('whatsapp_number', from);

        let resMsg = `📊 *RESUMEN DE CIERRE*\n\n`;
        resMsg += `• Efectivo Real: $${physical.toFixed(2)}\n`;
        resMsg += `• Sistema Espera: $${expected.toFixed(2)}\n`;
        resMsg += `---------------------------\n`;
        resMsg += `• DIFERENCIA: *${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}* ${diff === 0 ? '✅' : '⚠️'}\n\n`;
        resMsg += `¿Deseas cerrar el turno ahora?`;

        await sendWhatsAppButtons(from, resMsg, [{ id: 'yes', title: 'SÍ 🔒' }, { id: 'no', title: 'NO ❌' }]);
      }

      // ESTADO: Confirmación Final de Corte
      else if (step === 'awaiting_corte_confirmation') {
        if (isPositive) {
          await supabase.from('cash_snapshots').insert({
            store_id: profile.store_id,
            started_at: metadata.since,
            expected_cash: metadata.expected,
            actual_cash: metadata.physical,
            status: 'closed'
          });
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "✅ *Caja Cerrada*. Se ha guardado el registro del turno.");
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "Corte cancelado. ❌");
        }
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // B. COMANDOS NUEVOS
    if (profile) {
      const res = await executeCommand(text, supabase, profile.store_id, profile.role, from);
      if (res.nextStep) {
        await supabase.from('registration_states').upsert({ whatsapp_number: from, step: res.nextStep, metadata: res.metadata });
      }
      if (res.responseText) {
        if (['awaiting_confirmation', 'awaiting_bulk_confirmation', 'awaiting_void_confirmation'].includes(res.nextStep || '')) {
          await sendWhatsAppButtons(from, res.responseText, [{ id: 'yes', title: 'SÍ ✅' }, { id: 'no', title: 'NO ❌' }]);
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
      await sendWhatsAppMessage(from, "¡Código aceptado! ✅ ¿Cómo se llama tu negocio?");
    }

    await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[CRITICAL ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
