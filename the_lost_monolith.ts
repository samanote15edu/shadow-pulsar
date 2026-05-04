import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

// --- CONFIGURACI├ôN ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

import { executeCommand } from './parser.ts';

// --- CONFIGURACI├ôN ENV├ìO ---
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
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/[^\w\s]|_/g, "") // Quitar s├¡mbolos, ap├│strofes y puntuaci├│n
    .replace(/\s+/g, " "); // Colapsar m├║ltiples espacios
}

// Registro de depuraci├│n robusto (No bloqueante)
async function logDebug(phone: string, action: string, payload: any) {
  try {
    const { error } = await supabase.from('debug_logs').insert({ 
      payload: { phone, action, ...payload },
      created_at: new Date().toISOString()
    });
    if (error) console.warn(`[LOG ERROR] ${action}: ${error.message}`);
  } catch (e) {
    // Ignorar errores de log para no bloquear el flujo principal
  }
}

async function notifyOwner(storeId: string, message: string) {
  try {
    const { data: owner } = await supabase
      .from('profiles')
      .select('whatsapp_number, id')
      .eq('store_id', storeId)
      .eq('role', 'owner')
      .maybeSingle();

    if (owner) {
      console.log(`[NOTIFY] Enviando alerta a due├▒o (${owner.whatsapp_number})`);
      const magicLink = `https://shadow-pulsar.vercel.app/?s=${storeId}&u=${owner.id}`;
      await sendWhatsAppMessage(owner.whatsapp_number, `${message}\n\n≡ƒöù *Acceso Directo:* ${magicLink}`);
      await logDebug(owner.whatsapp_number, 'owner_notified', { storeId, message });
    } else {
      console.warn(`[NOTIFY] No se encontr├│ due├▒o para la tienda ${storeId}`);
      await logDebug('SYSTEM', 'owner_not_found', { storeId });
    }
  } catch (err) {
    console.error('[NOTIFY ERROR]', err);
  }
}

async function checkAndNotifyLowStock(storeId: string, productId: string) {
  try {
    const { data: prod } = await supabase
      .from('products')
      .select('name, current_stock, min_stock_alert')
      .eq('id', productId)
      .single();

    if (prod) {
      console.log(`[LOW STOCK CHECK] ${prod.name}: ${prod.current_stock} <= ${prod.min_stock_alert}`);
      if (prod.current_stock <= prod.min_stock_alert) {
        await notifyOwner(storeId, `ΓÜá∩╕Å *ALERTA DE STOCK BAJO*\n\nEl producto *${prod.name}* tiene solo *${prod.current_stock}* unidades restantes. Es momento de resurtir.`);
      }
    }
  } catch (err) {
    console.error('[LOW STOCK NOTIFY ERROR]', productId, err);
  }
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

    console.log(`[BOT] Mensaje recibido de ${from}: ${text}`);
    await logDebug(from, 'message_received', { text, normalized, messageId, buttonId });

    // --- 2. CONSULTAS DE CONTEXTO ---
    const [profileRes, stateRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('whatsapp_number', from).maybeSingle(),
      supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle()
    ]);

    const profile = profileRes.data;
    const state = stateRes.data;

    console.log(`[BOT] Contexto: Profile=${!!profile}, State=${state?.step || 'none'}`);
    await logDebug(from, 'context_check', { hasProfile: !!profile, state: state?.step || 'none' });

    // --- 3. LOGICA PRINCIPAL ---

    // A. FLUJO DE CONVERSACI├ôN ACTIVA (ESTADOS)
    if (state) {
      const { step, metadata } = state;

      const isPositive = isButtonYes || ['si', 's', 'yes', 'va', 'dale', 'ok', 'afirma', 'simon', 's├¡', 'si', 'pago completo'].some(k => normalized === k || normalized.includes('completo'));
      const isNegative = isButtonNo || ['no', 'n', 'nel', 'nones', 'cancelar', 'cancel', 'pago parcial', 'fiado'].some(k => normalized === k || normalized.includes('parcial'));
      const isExit = ['cancelar', 'salir', 'exit', 'cancel', 'reset', 'parar'].includes(normalized);

      if (isExit) {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, "Γ£à Operaci├│n cancelada. ┬┐En qu├⌐ m├ís puedo ayudarte?");
        return new Response('OK', { status: 200 });
      }

      // ESTADO: Registro de Tienda (Onboarding Inicial)
      if (step === 'awaiting_store_name') {
        await supabase.from('registration_states').update({ step: 'awaiting_owner_name', metadata: { store_name: text } }).eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `Entendido. ├Ültimo paso:\n\n┬┐Cu├íl es tu nombre completo? (Due├▒o)`);
      } 
      else if (step === 'awaiting_owner_name') {
        const { data: newStore } = await supabase.from('stores').insert({ name: metadata.store_name, owner_id: profile?.id }).select().single();
        await supabase.from('profiles').insert({ whatsapp_number: from, full_name: text, role: 'owner', store_id: newStore.id });
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `┬íFelicidades *${text}*! ≡ƒÜÇ Tu tienda *${metadata.store_name}* ya est├í registrada.`);
      }
      
      // ESTADO: Creaci├│n de Tienda Adicional (DUE├æO)
      else if (step === 'awaiting_new_store_name_creation') {
        const newStoreName = text.trim();
        const { data: newStore, error } = await supabase.from('stores').insert({
          name: newStoreName,
          owner_id: profile.id,
          logo_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(newStoreName)}`,
          description: 'Nueva sucursal'
        }).select().single();

        if (error) {
          await sendWhatsAppMessage(from, `Γ¥î Error al crear la tienda: ${error.message}`);
        } else {
          // Switch context immediately
          await supabase.from('profiles').update({ store_id: newStore.id }).eq('id', profile.id);
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          
          let msg = `Γ£¿ *┬íNueva Tienda Creada!* Γ£¿\n\n`;
          msg += `Nombre: *${newStore.name}*\n\n`;
          msg += `Ahora est├ís gestionando esta sucursal. Cualquier venta o inventario que registres se guardar├í aqu├¡.`;
          await sendWhatsAppMessage(from, msg);
        }
      }
      
      // ESTADO: Cantidad de Surtido desde Advertencia
      else if (step === 'awaiting_restock_qty_from_warning') {
        const qty = parseInt(text.replace(/[^0-9]/g, ''));
        if (isNaN(qty) || qty <= 0) {
          if (text.toLowerCase() === 'no') {
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, "Surtido cancelado. ≡ƒæì");
          } else {
            await sendWhatsAppMessage(from, "Γ¥î Por favor, env├¡a la cantidad recibida o escribe 'No'.");
          }
          return new Response('OK', { status: 200 });
        }

        await supabase.from('registration_states').update({
          step: 'awaiting_product_cost',
          metadata: { ...metadata, qty }
        }).eq('whatsapp_number', from);
        
        await sendWhatsAppMessage(from, `≡ƒôª *Surtido de ${metadata.productName}*\n\n┬┐Cu├ínto te cost├│ cada unidad esta vez?`);
      }

      // ESTADO: Costo de Producto
      else if (step === 'awaiting_product_cost') {
        const cost = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(cost)) {
          await sendWhatsAppMessage(from, "Γ¥î Env├¡a solo el n├║mero del costo (ej: 12.50)");
        } else {
          if (profile.role === 'employee') {
            await supabase.from('inventory_approvals').insert({
              store_id: profile.store_id,
              product_id: metadata.productId,
              type: 'restock',
              quantity: metadata.qty,
              new_value: cost,
              requester_name: profile.full_name,
              requester_phone: from,
              status: 'pending'
            });
            await notifyOwner(profile.store_id, `≡ƒôó *Nueva Aprobaci├│n Pendiente*\n\n*${profile.full_name}* ha registrado un *Surtido* de +${metadata.qty} unidades para *${metadata.productName}*.`);
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `ΓÅ│ *Surtido Pendiente*\n\nTu registro de +${metadata.qty} unidades de *${metadata.productName}* ha sido enviado para aprobaci├│n del due├▒o.`);
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
            await sendWhatsAppMessage(from, `Γ£à *Surtido Completado*\n\nProducto: ${metadata.productName}\nNuevo Costo: $${cost}\nCantidad: +${metadata.qty}`);
          }
        }
      }

      // ESTADO: Detalles de Producto Nuevo
      else if (step === 'awaiting_new_product_details') {
        const prices = text.match(/\d+(\.\d+)?/g);
        if (!prices || prices.length < 2) {
          await sendWhatsAppMessage(from, "Γ¥î Necesito los 2 precios (Costo y Venta). Ejemplo: '10 y 15'");
        } else {
          const cost = parseFloat(prices[0]);
          const sale = parseFloat(prices[1]);
          
          if (profile.role === 'employee') {
            await supabase.from('inventory_approvals').insert({
              store_id: profile.store_id,
              type: 'new_product',
              quantity: metadata.qty,
              new_value: cost,
              metadata: { productName: metadata.productName, base_price: sale },
              requester_name: profile.full_name,
              requester_phone: from,
              status: 'pending'
            });
            await notifyOwner(profile.store_id, `≡ƒôó *Nueva Aprobaci├│n Pendiente*\n\n*${profile.full_name}* quiere dar de alta un *Producto Nuevo*: *${metadata.productName}*.`);
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `ΓÅ│ *Producto Nuevo Pendiente*\n\nEl registro de *${metadata.productName}* ha sido enviado para aprobaci├│n del due├▒o.`);
          } else {
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
            await sendWhatsAppMessage(from, `Γ£à *┬íProducto Registrado!*\n\n${prod.name}\nCosto: $${cost}\nVenta: $${sale}\nStock: ${metadata.qty}`);
          }
        }
      }

      // ESTADO: Confirmaci├│n de Ticket (Individual)
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
            
            await sendWhatsAppButtons(from, `≡ƒôª *Venta Guardada*\n\nTotal: $${metadata.total}\n\n┬┐Deseas registrar el pago ahora?`, [
                { id: 'full', title: 'PAGO COMPLETO Γ£à' },
                { id: 'partial', title: 'PAGO PARCIAL/FIADO ≡ƒô¥' }
            ]);

            // Alerta de Stock Bajo al Due├▒o
            await checkAndNotifyLowStock(profile.store_id, metadata.productId);
            
            return new Response('OK', { status: 200 });
          }
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Operaci├│n cancelada. Γ¥î");
        } else {
          await sendWhatsAppButtons(from, "┬┐Confirmas la operaci├│n?", [{ id: 'yes', title: 'S├ì Γ£à' }, { id: 'no', title: 'NO Γ¥î' }]);
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmaci├│n de Ticket Masivo
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

          await sendWhatsAppButtons(from, `≡ƒÑñ *Ticket Guardado*\n\nTotal: $${metadata.total}\n\n┬┐C├│mo se realiz├│ el pago?`, [
            { id: 'full', title: 'PAGO COMPLETO Γ£à' },
            { id: 'partial', title: 'PAGO PARCIAL/FIADO ≡ƒô¥' }
          ]);

          // Alerta de Stock Bajo al Due├▒o (Para cada item del ticket)
          for (const item of metadata.items) {
            await checkAndNotifyLowStock(profile.store_id, item.productId);
          }

          return new Response('OK', { status: 200 });
        } else if (isNegative) {
          await sendWhatsAppMessage(from, "Ticket cancelado. Γ¥î");
        } else {
          await sendWhatsAppButtons(from, "┬┐Confirmas todo el ticket?", [{ id: 'yes', title: 'S├ì Γ£à' }, { id: 'no', title: 'NO Γ¥î' }]);
          return new Response('OK', { status: 200 }); 
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmaci├│n de Pago (NUEVO)
      else if (step === 'awaiting_payment_confirmation') {
        if (isPositive) {
          const items = metadata.transactionIds;
          for (const item of items) {
             await supabase.from('transactions').update({ amount_received: item.total }).eq('id', item.id);
          }
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `Γ£à *Pago Completo Registrado*\n\nVenta cerrada con ├⌐xito.`);

          // CHEQUEO FINAL DE STOCK (Tras pago completo)
          const idsToCheck = items.map(it => it.id);
          const { data: finalTxs } = await supabase.from('transactions').select('product_id, products(name, current_stock)').in('id', idsToCheck);
          
          if (finalTxs) {
            for (const tx of finalTxs) {
              const prod = (tx as any).products;
              if (prod && prod.current_stock < 0) {
                await sendWhatsAppMessage(from, `ΓÜá∩╕Å *ALERTA:* El stock de *${prod.name}* qued├│ en ${prod.current_stock}.\n\n┬┐Deseas registrar un *surtido* ahora? Escribe la cantidad recibida (ej: 20) o escribe "No".`);
                // Cambiamos a un nuevo estado intermedio que capture la cantidad primero
                await supabase.from('registration_states').upsert({ 
                  whatsapp_number: from, 
                  step: 'awaiting_restock_qty_from_warning', 
                  metadata: { productId: tx.product_id, productName: prod.name } 
                });
                break; 
              }
            }
          }
        } else if (isNegative) {
          await supabase.from('registration_states').update({ 
            step: 'awaiting_paid_amount',
            metadata: { ...metadata } 
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `≡ƒÆ░ *Pago Parcial*\n\n┬┐Cu├ínto recibiste en efectivo?`);
        } else {
          await sendWhatsAppButtons(from, "┬┐C├│mo fue el pago?", [
            { id: 'full', title: 'PAGO COMPLETO Γ£à' },
            { id: 'partial', title: 'PAGO PARCIAL/FIADO ≡ƒô¥' }
          ]);
        }
      }

      // ESTADO: Captura de monto (Usado en el flujo de Pago Parcial y Auditor├¡a)
      else if (step === 'awaiting_paid_amount') {
        const received = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(received)) {
          await sendWhatsAppMessage(from, "Γ¥î Env├¡a solo el n├║mero.");
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
          await sendWhatsAppMessage(from, `≡ƒô¥ *Ajuste: $${debt.toFixed(2)} pendientes*\n\n┬┐A qui├⌐n le anotamos esta deuda? (Escribe su nombre)`);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `Γ£à *Pago Registrado*\n\nLa venta se marc├│ como pagada totalmente.`);
        }
      }

      // ESTADO: Deuda retroactiva (Corregir)
      else if (step === 'awaiting_correction_amount') {
        const received = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(received)) {
          await sendWhatsAppMessage(from, "Γ¥î Env├¡a solo el n├║mero.");
          return new Response('OK', { status: 200 });
        }
        const debt = metadata.total - received;
        await supabase.from('transactions').update({ amount_received: received }).eq('id', metadata.transactionId);
        if (debt > 0) {
          await supabase.from('registration_states').update({ step: 'awaiting_customer_assignment', metadata: { ...metadata, debt } }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `≡ƒô¥ *Pendiente de Cobro: $${debt}*\n\n┬┐A nombre de qui├⌐n registramos el fiado?`);
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `Γ£à *┬íListo!*\n\nVenta actualizada.`);
        }
      }

      // SIGUIENTES ESTADOS (Auditor├¡a, Similitud, Anulaci├│n, Ledger)
      // ... manteniendo el resto de la l├│gica ...
      else if (step === 'awaiting_similarity_confirmation') {
        if (isPositive) {
          await supabase.from('registration_states').update({
            step: 'awaiting_product_cost',
            metadata: { ...metadata }
          }).eq('whatsapp_number', from);
          
          await sendWhatsAppMessage(from, `≡ƒôª *Surtido de ${metadata.productName}*\n\n┬┐Cu├ínto te cost├│ cada ${metadata.unit || 'unidad'} esta vez?`);
        } else if (isNegative) {
          await supabase.from('registration_states').update({
            step: 'awaiting_new_product_details',
            metadata: { productName: metadata.newName, qty: metadata.qty }
          }).eq('whatsapp_number', from);
          
          await sendWhatsAppMessage(from, `Γ£¿ *┬íNuevo Producto!* Γ£¿\n\nRegistrando "${metadata.newName}".\n\nPor favor, dime:\n1. ┬┐Cu├ínto te cost├│?\n2. ┬┐A cu├ínto lo vender├ís?\n\n(Ejemplo: 12 y 20)`);
        } else {
          await sendWhatsAppButtons(from, `≡ƒöì *┬┐Es el mismo producto?*\n\n┬┐Es "${metadata.productName}" lo mismo que "${metadata.newName}"?`, [
            { id: 'yes', title: 'S├ì Γ£à' },
            { id: 'no', title: 'NO Γ¥î' }
          ]);
        }
      }
      else if (step === 'awaiting_void_confirmation') {
          if (isPositive) {
            await supabase.from('transactions').update({ is_voided: true }).eq('id', metadata.transactionId);
            await supabase.rpc('increment_stock', { row_id: metadata.productId, amount: metadata.qty });
            await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: metadata.productId, type: 'void', quantity_change: metadata.qty, total_amount: metadata.total, notes: `Reversa ID: ${metadata.transactionId}` });
            await sendWhatsAppMessage(from, `Γ£à *Venta Anulada*`);
          } else { await sendWhatsAppMessage(from, "Cancelado."); }
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }
      else if (step === 'awaiting_physical_count') {
          const idx = metadata.currentIndex;
          if (normalized === 'fin') {
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, "≡ƒÅü Conteo finalizado.");
          } else {
            const actual = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (!isNaN(actual)) {
              if (profile.role === 'employee') {
                const diff = actual - metadata.stocks[idx];
                if (diff !== 0) {
                  await supabase.from('inventory_approvals').insert({
                    store_id: profile.store_id,
                    product_id: metadata.productsIds[idx],
                    type: 'adjustment',
                    quantity: diff,
                    old_value: metadata.stocks[idx],
                    new_value: actual,
                    requester_name: profile.full_name,
                    requester_phone: from,
                    status: 'pending'
                  });
                  await notifyOwner(profile.store_id, `≡ƒôó *Nueva Aprobaci├│n Pendiente*\n\n*${profile.full_name}* ha registrado un *Ajuste de Auditor├¡a* para *${metadata.names[idx]}* (Diferencia: ${diff}).`);
                }
              } else {
                await supabase.from('products').update({ current_stock: actual }).eq('id', metadata.productsIds[idx]);
                const diff = actual - metadata.stocks[idx];
                if (diff !== 0) await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: metadata.productsIds[idx], type: 'correction', quantity_change: diff, notes: 'Auditor├¡a' });
              }
            }
            const nextIdx = idx + 1;
            if (nextIdx < metadata.productsIds.length) {
              const nextName = metadata.names[nextIdx];
              await supabase.from('registration_states').update({ metadata: { ...metadata, currentIndex: nextIdx } }).eq('whatsapp_number', from);
              await sendWhatsAppMessage(from, `*Producto: ${nextName}*\n┬┐Cu├íntos hay?`);
            } else {
              await supabase.from('registration_states').delete().eq('whatsapp_number', from);
              const msg = profile.role === 'employee' ? "≡ƒÅü Conteo finalizado. Los ajustes han sido enviados para aprobaci├│n." : "≡ƒÅü Auditor├¡a terminada. Stock actualizado.";
              await sendWhatsAppMessage(from, msg);
            }
          }
      }
      else if (step === 'awaiting_audit_selection') {
          const idx = parseInt(text, 10) - 1;
          const item = metadata.items[idx];
          if (item) {
            await supabase.from('registration_states').update({ step: 'awaiting_paid_amount', metadata: { transactionId: item.id, total: item.total_amount } }).eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `Auditando venta de $${item.total_amount}. ┬┐Cu├ínto se cobr├│?`);
          } else { await sendWhatsAppMessage(from, "Inv├ílido."); }
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
          await sendWhatsAppMessage(from, `≡ƒñ¥ Deuda registrada a ${name}.`);

          // CHEQUEO FINAL DE STOCK (Tras registro de deuda)
          const { data: finalTxs } = await supabase.from('transactions').select('product_id, products(name, current_stock)').in('id', txIds);
          if (finalTxs) {
            for (const tx of finalTxs) {
              const prod = (tx as any).products;
              if (prod && prod.current_stock < 0) {
                await sendWhatsAppMessage(from, `ΓÜá∩╕Å *ALERTA:* Tras la deuda de ${name}, el stock de *${prod.name}* qued├│ en ${prod.current_stock}.\n\n┬┐Deseas registrar un *surtido* ahora? Escribe la cantidad recibida o responde "No".`);
                await supabase.from('registration_states').upsert({ 
                  whatsapp_number: from, 
                  step: 'awaiting_restock_qty_from_warning', 
                  metadata: { productId: tx.product_id, productName: prod.name } 
                });
                break;
              }
            }
          }
      }

      // ESTADO: Captura de efectivo f├¡sico (Corte Ciego)
      else if (step === 'awaiting_physical_cash') {
        const physical = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(physical)) {
          await sendWhatsAppMessage(from, "Γ¥î Env├¡a solo el n├║mero del efectivo que tienes.");
          return new Response('OK', { status: 200 });
        }

        // Obtener ├║ltimo cierre
        let sinceTimestamp = '1970-01-01T00:00:00Z';
        const { data: lastCorte } = await supabase
          .from('cash_snapshots')
          .select('closed_at')
          .eq('store_id', profile.store_id)
          .order('closed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (lastCorte) sinceTimestamp = lastCorte.closed_at;

        // Calcular efectivo esperado (suma de todos los amount_received desde el ├║ltimo corte)
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

        let resMsg = `≡ƒôè *RESUMEN DE CIERRE*\n\n`;
        resMsg += `ΓÇó Efectivo Real: $${physical.toFixed(2)}\n`;
        resMsg += `ΓÇó Sistema Espera: $${expected.toFixed(2)}\n`;
        resMsg += `---------------------------\n`;
        resMsg += `ΓÇó DIFERENCIA: *${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}* ${diff === 0 ? 'Γ£à' : 'ΓÜá∩╕Å'}\n\n`;
        resMsg += `┬┐Deseas cerrar el turno ahora?`;

        await sendWhatsAppButtons(from, resMsg, [{ id: 'yes', title: 'S├ì ≡ƒöÆ' }, { id: 'no', title: 'NO Γ¥î' }]);
      }

      // ESTADO: Confirmaci├│n Final de Corte
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
          await sendWhatsAppMessage(from, "Γ£à *Caja Cerrada*. Se ha guardado el registro del turno.");
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "Corte cancelado. Γ¥î");
        }
      }

      // ESTADO: Confirmaci├│n de Ajuste de Costo Directo
      else if (step === 'awaiting_cost_confirmation') {
        if (isPositive) {
          if (profile.role === 'employee') {
            await supabase.from('inventory_approvals').insert({
              store_id: profile.store_id,
              product_id: metadata.productId,
              type: 'cost_change',
              new_value: metadata.newCost,
              requester_name: profile.full_name,
              requester_phone: from,
              status: 'pending'
            });
            await notifyOwner(profile.store_id, `≡ƒôó *Nueva Aprobaci├│n Pendiente*\n\n*${profile.full_name}* solicita cambiar el *Costo* de *${metadata.productName}* a $${metadata.newCost}.`);
            await sendWhatsAppMessage(from, `ΓÅ│ *Ajuste de Costo Pendiente*\n\nSe ha enviado la solicitud para cambiar el costo de *${metadata.productName}* a $${metadata.newCost}.`);
          } else {
            await supabase.from('products').update({ last_cost_price: metadata.newCost }).eq('id', metadata.productId);
            await sendWhatsAppMessage(from, `Γ£à *Costo Actualizado*\n\nEl nuevo costo para *${metadata.productName}* es $${metadata.newCost}.`);
          }
        } else {
          await sendWhatsAppMessage(from, "Ajuste cancelado. Γ¥î");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmaci├│n de Ajuste de Precio de Venta Directo
      else if (step === 'awaiting_price_confirmation') {
        if (isPositive) {
          if (profile.role === 'employee') {
            await supabase.from('inventory_approvals').insert({
              store_id: profile.store_id,
              product_id: metadata.productId,
              type: 'price_change',
              new_value: metadata.newPrice,
              requester_name: profile.full_name,
              requester_phone: from,
              status: 'pending'
            });
            await notifyOwner(profile.store_id, `≡ƒôó *Nueva Aprobaci├│n Pendiente*\n\n*${profile.full_name}* solicita cambiar el *Precio de Venta* de *${metadata.productName}* a $${metadata.newPrice}.`);
            await sendWhatsAppMessage(from, `ΓÅ│ *Ajuste de Precio Pendiente*\n\nSe ha enviado la solicitud para cambiar el precio de *${metadata.productName}* a $${metadata.newPrice}.`);
          } else {
            await supabase.from('products').update({ base_price: metadata.newPrice }).eq('id', metadata.productId);
            await sendWhatsAppMessage(from, `Γ£à *Precio de Venta Actualizado*\n\nEl nuevo precio para *${metadata.productName}* es $${metadata.newPrice}.`);
          }
        } else {
          await sendWhatsAppMessage(from, "Ajuste cancelado. Γ¥î");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmaci├│n de Abono a Deuda (Ledgers)
      else if (step === 'awaiting_payment_ledgers_confirmation') {
        if (isPositive) {
          const { customerName, amount } = metadata;
          
          // 1. Buscar al deudor (ignora may├║sculas/min├║sculas)
          const { data: ledger } = await supabase
            .from('fiado_ledgers')
            .select('*')
            .eq('store_id', profile.store_id)
            .ilike('customer_name', customerName)
            .maybeSingle();

          if (!ledger) {
            await sendWhatsAppMessage(from, `Γ¥î No encontr├⌐ a ning├║n deudor llamado "${customerName}".`);
          } else {
            // 2. Actualizar balance
            const newBalance = Math.max(0, Number(ledger.current_balance) - amount);
            await supabase
              .from('fiado_ledgers')
              .update({ 
                current_balance: newBalance, 
                last_update_at: new Date().toISOString() 
              })
              .eq('id', ledger.id);

            // 3. Registrar transacci├│n de pago para Auditor├¡a y Corte de Caja
            await supabase.from('transactions').insert({
              store_id: profile.store_id,
              type: 'fiado_payment',
              quantity_change: 0,
              total_amount: amount,
              amount_received: amount,
              customer_id: ledger.id,
              notes: `Abono v├¡a WhatsApp: ${ledger.customer_name}`
            });

            await sendWhatsAppMessage(from, `Γ£à *Abono Registrado*\n\nCliente: ${ledger.customer_name}\nRecibido: $${amount}\nSaldo pendiente: *$${newBalance.toFixed(2)}*`);
          }
        } else {
          await sendWhatsAppMessage(from, "Abono cancelado. Γ¥î");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // B. COMANDOS NUEVOS
    if (profile) {
      console.time('executeCommand');
      const res = await executeCommand(text, supabase, profile.store_id, profile.role, from, profile.id);
      console.timeEnd('executeCommand');
      
      if (res.nextStep) {
        await supabase.from('registration_states').upsert({ whatsapp_number: from, step: res.nextStep, metadata: res.metadata });
      }

      if (res.responseText) {
        if (['awaiting_confirmation', 'awaiting_bulk_confirmation', 'awaiting_void_confirmation', 'awaiting_cost_confirmation', 'awaiting_price_confirmation', 'awaiting_payment_ledgers_confirmation'].includes(res.nextStep || '')) {
          await sendWhatsAppButtons(from, res.responseText, [{ id: 'yes', title: 'S├ì Γ£à' }, { id: 'no', title: 'NO Γ¥î' }]);
        } else {
          await sendWhatsAppMessage(from, res.responseText);
        }
      } else {
        await sendWhatsAppMessage(from, "≡ƒñö No entend├¡. Prueba con: 'Inventario' o una lista como '2 cocas'.");
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // C. C├ôDIGO INICIAL (Validaci├│n din├ímica con Base de Datos)
    const { data: invite } = await supabase
      .from('invite_codes')
      .select('*')
      .eq('code', normalized.toUpperCase())
      .eq('is_active', true)
      .maybeSingle();

    if (invite) {
      // 1. Verificar Expiraci├│n
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        await sendWhatsAppMessage(from, "Γ¥î Este c├│digo de invitaci├│n ha expirado. Por favor, solicita uno nuevo al due├▒o de la tienda.");
        return new Response('OK', { status: 200 });
      }

      // 2. Verificar Usos
      if (invite.current_uses >= invite.max_uses) {
        await sendWhatsAppMessage(from, "Γ¥î Este c├│digo ya ha sido utilizado el m├íximo de veces permitido.");
        return new Response('OK', { status: 200 });
      }

      const metadata = invite.metadata || {};

      // 3. Flujo Directo para Empleados
      if (metadata.role === 'employee' && metadata.store_id) {
        // Registrar empleado directamente
        await supabase.from('profiles').insert({ 
          whatsapp_number: from, 
          role: 'employee', 
          store_id: metadata.store_id,
          full_name: 'Empleado' // Se puede pedir despu├⌐s o dejar gen├⌐rico
        });

        // Incrementar uso del c├│digo
        await supabase.from('invite_codes')
          .update({ current_uses: invite.current_uses + 1 })
          .eq('code', invite.code);

        // Obtener info de la tienda para la bienvenida
        const { data: store } = await supabase.from('stores').select('name').eq('id', metadata.store_id).single();
        
        await sendWhatsAppMessage(from, `Γ£à ┬íBienvenido! Has sido registrado como empleado en *${store?.name || 'la tienda'}*.\n\nYa puedes registrar ventas escribiendo algo como: "2 cocas" o "Fiado Maria: 1 gansito".`);

        // Notificar al Due├▒o
        const { data: owner } = await supabase.from('profiles').select('whatsapp_number').eq('store_id', metadata.store_id).eq('role', 'owner').maybeSingle();
        if (owner) {
          await sendWhatsAppMessage(owner.whatsapp_number, `≡ƒôó *Aviso:* Un nuevo empleado (Terminaci├│n ..${from.slice(-4)}) se ha unido a tu tienda usando el c├│digo *${invite.code}*.`);
        }
      } 
      // 4. Flujo para Due├▒os Nuevos (Sin metadata de empleado)
      else {
        await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_store_name' });
        await sendWhatsAppMessage(from, "┬íC├│digo aceptado! Γ£à ┬┐C├│mo se llama tu negocio?");
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // C├│digo gen├⌐rico legado (opcional mantener o quitar)
    if (normalized === 'tiendita2026') {
      await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_store_name' });
      await sendWhatsAppMessage(from, "┬íC├│digo aceptado! Γ£à ┬┐C├│mo se llama tu negocio?");
      return new Response('OK', { status: 200 });
    }

    await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[CRITICAL ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
