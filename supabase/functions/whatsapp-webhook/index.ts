import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

// --- CONFIGURACIÓN ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

import { executeCommand, generateVisualReceipt, type FiadoItem } from './parser.ts';

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

// --- MEDIA HELPERS ---
async function downloadAndUploadImage(mediaId: string, storeId: string, profileId: string): Promise<string | null> {
  try {
    const mediaUrlRes = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
    });
    const mediaUrlData = await mediaUrlRes.json();
    if (!mediaUrlData.url) return null;

    const imgRes = await fetch(mediaUrlData.url, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
    });
    const imgBlob = await imgRes.blob();
    const fileName = `${storeId}/${profileId}/${Date.now()}.jpg`;

    const { data, error } = await supabase.storage
      .from('evidences')
      .upload(fileName, imgBlob, { contentType: 'image/jpeg' });

    if (error) throw error;
    
    // Devolvemos la URL pública
    const { data: { publicUrl } } = supabase.storage.from('evidences').getPublicUrl(fileName);
    return publicUrl;
  } catch (err) {
    console.error('[MEDIA ERROR]', err);
    return null;
  }
}

// --- UTILIDADES ---
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/[^\w\s]|_/g, "") // Quitar símbolos, apóstrofes y puntuación
    .replace(/\s+/g, " "); // Colapsar múltiples espacios
}

// Registro de depuración robusto (No bloqueante)
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
      console.log(`[NOTIFY] Enviando alerta a dueño (${owner.whatsapp_number})`);
      const magicLink = `https://shadow-pulsar.vercel.app/?s=${storeId}&u=${owner.id}`;
      await sendWhatsAppMessage(owner.whatsapp_number, `${message}\n\n🔗 *Acceso Directo:* ${magicLink}`);
      await logDebug(owner.whatsapp_number, 'owner_notified', { storeId, message });
    } else {
      console.warn(`[NOTIFY] No se encontró dueño para la tienda ${storeId}`);
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
        await notifyOwner(storeId, `⚠️ *ALERTA DE STOCK BAJO*\n\nEl producto *${prod.name}* tiene solo *${prod.current_stock}* unidades restantes. Es momento de resurtir.`);
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
    } else if (message.type === 'image') {
      text = message.image.caption || '';
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

    // --- 2. CONSULTAS DE CONTEXTO ---
    const [profileRes, stateRes] = await Promise.all([
      supabase.from('profiles').select('*, stores(*)').eq('whatsapp_number', from).maybeSingle(),
      supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle()
    ]);

    const profile = profileRes.data;
    const state = stateRes.data;
    const store = Array.isArray(profile?.stores) ? profile.stores[0] : profile?.stores;

    // Log contextual (No bloquea la decisión principal)
    logDebug(from, 'message_received', { text, normalized, messageId, buttonId, hasProfile: !!profile });
    const isMagicCode = normalized === 'tiendita2026' || normalized === 'servicios2026';
    const isSwitchCommand = normalized === 'cambiar' || normalized === 'switch' || normalized.includes('cambiar tienda');

    if (isMagicCode || isSwitchCommand) {
      // Limpiar cualquier estado anterior si detectamos un comando global
      if (state) {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      if (isMagicCode) {
        const bType = normalized === 'tiendita2026' ? 'inventory' : 'activity_logs';
        await supabase.from('registration_states').upsert({
          whatsapp_number: from,
          step: 'awaiting_company_name',
          metadata: { business_type: bType }
        });
        await sendWhatsAppMessage(from, `¡Código aceptado! 🚀\n\n¿Cuál es el nombre de tu empresa?`);
        return new Response('OK', { status: 200 });
      }

      if (isSwitchCommand && profile) {
        // Buscar todas las tiendas donde este usuario sea dueño
        const { data: userStores } = await supabase.from('stores').select('id, name').eq('owner_id', profile.id);
        
        if (userStores && userStores.length > 1) {
          const buttons = userStores.slice(0, 3).map(s => ({
            id: `switch_to_${s.id}`,
            title: s.name.substring(0, 20)
          }));
          await sendWhatsAppButtons(from, "🏢 *Tus Negocios*\n\nSelecciona la tienda que quieres gestionar ahora:", buttons);
        } else {
          await sendWhatsAppMessage(from, "Solo tienes una tienda registrada o no eres el dueño. Para registrar otra usa un código de activación.");
        }
        return new Response('OK', { status: 200 });
      }
    }

    // Handle Switch Button Reply
    if (buttonId.startsWith('switch_to_') && profile) {
      const targetId = buttonId.replace('switch_to_', '');
      await supabase.from('profiles').update({ store_id: targetId }).eq('id', profile.id);
      const { data: targetStore } = await supabase.from('stores').select('name, business_type').eq('id', targetId).single();
      
      const welcomeMsg = targetStore?.business_type === 'activity_logs' 
        ? `✅ Ahora estás gestionando *${targetStore.name}* (Modo Bitácora).\n\nEscribe la descripción de la actividad para empezar.`
        : `✅ Ahora estás gestionando *${targetStore.name}* (Modo Inventario).\n\n¿En qué puedo ayudarte?`;
        
      await sendWhatsAppMessage(from, welcomeMsg);
      return new Response('OK', { status: 200 });
    }

    // --- 4. LOGICA DE ESTADOS ---
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

      // ESTADO: Captura de Nombre de Empresa (Flujo robusto)
      if (step === 'awaiting_company_name') {
        const storeName = text.trim();
        if (profile) {
          // Usuario ya existe: crear tienda vinculada inmediatamente
          const { data: newStore } = await supabase.from('stores').insert({ 
            name: storeName, 
            owner_id: profile.id,
            business_type: metadata.business_type 
          }).select().single();
          
          if (newStore) {
            await supabase.from('profiles').update({ store_id: newStore.id }).eq('id', profile.id);
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            const mode = metadata.business_type === 'activity_logs' ? 'Bitácora' : 'Inventario';
            await sendWhatsAppMessage(from, `✅ ¡Todo listo! Tu nueva empresa *${storeName}* ha sido registrada en modo *${mode}*.\n\nAhora la tienes seleccionada.`);
          }
        } else {
          // Usuario nuevo: pasar a pedir nombre
          await supabase.from('registration_states').update({ 
            step: 'awaiting_owner_name_for_new_store', 
            metadata: { ...metadata, store_name: storeName } 
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `Entendido. Último paso:\n\n¿Cuál es tu nombre completo?`);
        }
        return new Response('OK', { status: 200 });
      }

      // ESTADO: Captura de Nombre de Dueño (Para usuarios nuevos)
      else if (step === 'awaiting_owner_name_for_new_store') {
        const ownerName = text.trim();
        const { data: newProfile } = await supabase.from('profiles').insert({ 
          whatsapp_number: from, 
          full_name: ownerName, 
          role: 'owner' 
        }).select().single();

        if (newProfile) {
          const { data: newStore } = await supabase.from('stores').insert({ 
            name: metadata.store_name, 
            owner_id: newProfile.id,
            business_type: metadata.business_type
          }).select().single();

          if (newStore) {
            await supabase.from('profiles').update({ store_id: newStore.id }).eq('id', newProfile.id);
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            const mode = metadata.business_type === 'activity_logs' ? 'Bitácora' : 'Inventario';
            await sendWhatsAppMessage(from, `¡Bienvenido *${ownerName}*! 🚀\n\nEmpresa *${metadata.store_name}* creada en modo *${mode}*.`);
          }
        }
        return new Response('OK', { status: 200 });
      }

      // --- NUEVOS FLUJOS CONVERSACIONALES (REDUCCIÓN DE FRICCIÓN) ---

      // FIADO GUIADO: Captura de Nombre
      else if (step === 'awaiting_fiado_name_guided') {
        const customer = text.trim();
        await supabase.from('registration_states').update({ 
          step: 'awaiting_fiado_items_guided', 
          metadata: { customer } 
        }).eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `👤 *Fiado para ${customer}*\n\n¿Qué productos se lleva? (Ej: '2 cocas y 1 gansito')`);
      }

      // FIADO GUIADO: Captura de Productos (Reutiliza lógica del parser)
      else if (step === 'awaiting_fiado_items_guided') {
         // Re-inyectamos el comando completo para que el parser haga su magia
         const proxyMsg = `Fiado ${metadata.customer}: ${text}`;
         const res = await executeCommand(proxyMsg, supabase, profile.store_id, profile.role, from, profile.id);
         
         if (res.nextStep) {
           await supabase.from('registration_states').update({ step: res.nextStep, metadata: res.metadata }).eq('whatsapp_number', from);
           await sendWhatsAppMessage(from, res.responseText);
         } else {
           await sendWhatsAppMessage(from, "❌ No entendí la lista de productos. Prueba algo como '2 cocas'.");
         }
      }

      // FIADO: Captura de Cantidad para Item Específico
      else if (step === 'awaiting_item_qty') {
        const qty = parseInt(text.replace(/[^0-9]/g, ''));
        if (isNaN(qty) || qty <= 0) {
          await sendWhatsAppMessage(from, "❌ Por favor envía un número válido para la cantidad (ej: 3).");
          return new Response('OK', { status: 200 });
        }

        const items = [...metadata.items];
        items[metadata.currentIdx].qty = qty;

        // Buscar el siguiente que falte (Prioridad Cantidad)
        const nextMissingQtyIdx = items.findIndex((it, idx) => idx > metadata.currentIdx && it.qty === null);
        
        if (nextMissingQtyIdx !== -1) {
          await supabase.from('registration_states').update({
            metadata: { ...metadata, items, currentIdx: nextMissingQtyIdx }
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `👤 *Fiado para ${metadata.customer}*\n\n¿Cuántas unidades de *${items[nextMissingQtyIdx].name}*?`);
        } else {
          // Ya no faltan cantidades, buscar si faltan precios
          const nextMissingPriceIdx = items.findIndex(it => it.price === null);
          if (nextMissingPriceIdx !== -1) {
            await supabase.from('registration_states').update({
              step: 'awaiting_item_price',
              metadata: { ...metadata, items, currentIdx: nextMissingPriceIdx }
            }).eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `👤 *Fiado para ${metadata.customer}*\n\n¿A cuánto vendiste *${items[nextMissingPriceIdx].name}*?`);
          } else {
            // Ya tenemos todo
            const ticket = generateVisualReceipt(metadata.customer, items);
            await supabase.from('registration_states').update({
              step: 'awaiting_fiado_approval',
              metadata: { ...metadata, items }
            }).eq('whatsapp_number', from);
            await sendWhatsAppButtons(from, ticket, [
              { id: 'yes', title: 'SÍ ✅' },
              { id: 'no', title: 'NO ❌' }
            ]);
          }
        }
      }

      // FIADO: Captura de Precio para Item Específico
      else if (step === 'awaiting_item_price') {
        const price = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(price)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número del precio (ej: 15.50)");
          return new Response('OK', { status: 200 });
        }

        const items = [...metadata.items];
        items[metadata.currentIdx].price = price;

        // Buscar el siguiente que falte
        const nextMissingIdx = items.findIndex((it, idx) => idx > metadata.currentIdx && it.price === null);
        
        if (nextMissingIdx !== -1) {
          await supabase.from('registration_states').update({
            metadata: { ...metadata, items, currentIdx: nextMissingIdx }
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `👤 *Fiado para ${metadata.customer}*\n\n¿A cuánto vendiste *${items[nextMissingIdx].name}*?`);
        } else {
          // Ya tenemos todos los precios, generar Ticket
          const ticket = generateVisualReceipt(metadata.customer, items);
          await supabase.from('registration_states').update({
            step: 'awaiting_fiado_approval',
            metadata: { ...metadata, items }
          }).eq('whatsapp_number', from);
          await sendWhatsAppButtons(from, ticket, [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
        }
      }

      // FIADO: Confirmación Final del Ticket
      else if (step === 'awaiting_fiado_approval') {
        if (isPositive) {
          const { customer, items } = metadata;
          
          // 1. Buscar/Crear el Ledger del Cliente
          let { data: ledger } = await supabase.from('fiado_ledgers').select('*').eq('store_id', profile.store_id).ilike('customer_name', customer).maybeSingle();
          if (!ledger) {
            const { data: newL } = await supabase.from('fiado_ledgers').insert({ store_id: profile.store_id, customer_name: customer, current_balance: 0 }).select().single();
            ledger = newL;
          }

          let ticketTotal = 0;
          const transactionIds = [];

          // 2. Procesar cada item
          const { data: allProds } = await supabase.from('products').select('*').eq('store_id', profile.store_id).eq('is_active', true);
          
          for (const it of items) {
            const prod = allProds?.find(p => p.name.toLowerCase().includes(it.name.toLowerCase()) || it.name.toLowerCase().includes(p.name.toLowerCase()));
            const lineTotal = (it.qty || 1) * (it.price || 0);
            ticketTotal += lineTotal;

            if (prod) {
              await supabase.rpc('increment_stock', { row_id: prod.id, amount: -it.qty });
              const { data: tx } = await supabase.from('transactions').insert({
                store_id: profile.store_id,
                product_id: prod.id,
                customer_id: ledger.id,
                type: 'sale',
                quantity_change: -it.qty,
                unit_price: it.price,
                total_amount: lineTotal,
                amount_received: 0, // Es fiado
                notes: `Fiado: ${customer}`
              }).select().single();
              if (tx) transactionIds.push({ id: tx.id, total: lineTotal, productId: prod.id, productName: prod.name });
            } else {
              // Si no existe el producto, solo registramos la transacción contable vinculada al ledger
              const { data: tx } = await supabase.from('transactions').insert({
                store_id: profile.store_id,
                customer_id: ledger.id,
                type: 'sale',
                quantity_change: -it.qty,
                unit_price: it.price,
                total_amount: lineTotal,
                amount_received: 0,
                notes: `Fiado (Item sin inv): ${it.name}`
              }).select().single();
              if (tx) transactionIds.push({ id: tx.id, total: lineTotal });
            }
          }

          // 3. Actualizar balance del deudor
          await supabase.from('fiado_ledgers').update({ 
            current_balance: Number(ledger.current_balance) + ticketTotal,
            last_update_at: new Date().toISOString()
          }).eq('id', ledger.id);

          await sendWhatsAppMessage(from, `✅ *Fiado Guardado*\n\nSe han registrado $${ticketTotal.toFixed(2)} a la cuenta de ${customer}.`);
          
          // 4. Chequeo de Stock y transición a alerta si es necesario
          await supabase.from('registration_states').delete().eq('whatsapp_number', from); // Limpiar primero
          
          for (const tx of transactionIds) {
            if (tx.productId) {
               await checkAndNotifyLowStock(profile.store_id, tx.productId);
               // Si el stock quedó negativo, ofrecer surtido
               const { data: p } = await supabase.from('products').select('current_stock').eq('id', tx.productId).single();
               if (p && p.current_stock < 0) {
                 await sendWhatsAppMessage(from, `⚠️ *AVISO:* El stock de *${tx.productName}* quedó en ${p.current_stock}.\n\n¿Quieres registrar un surtido ahora? Escribe la cantidad o responde "No".`);
                 await supabase.from('registration_states').upsert({
                   whatsapp_number: from,
                   step: 'awaiting_restock_qty_from_warning',
                   metadata: { productId: tx.productId, productName: tx.productName }
                 });
                 break; // Solo una alerta por ticket para no saturar
               }
            }
          }
        } else if (isNegative) {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "Fiado cancelado. ❌");
        } else {
          await sendWhatsAppButtons(from, "¿Confirmas el ticket de fiado?", [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
        }
      }

      // ABONO GUIADO: Captura de Nombre
      else if (step === 'awaiting_abono_name_guided') {
        const customerName = text.trim();
        await supabase.from('registration_states').update({ 
          step: 'awaiting_abono_amount_guided', 
          metadata: { customerName } 
        }).eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, `💰 *Abono de ${customerName}*\n\n¿Cuánto va a pagar? (Escribe solo el número)`);
      }

      // ABONO GUIADO: Captura de Monto
      else if (step === 'awaiting_abono_amount_guided') {
        const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          await sendWhatsAppMessage(from, "❌ Por favor envía un monto válido.");
          return new Response('OK', { status: 200 });
        }
        await supabase.from('registration_states').update({ 
          step: 'awaiting_payment_ledgers_confirmation', 
          metadata: { ...metadata, amount } 
        }).eq('whatsapp_number', from);
        await sendWhatsAppButtons(from, `💰 *Confirmar Abono*\n\n¿Registrar pago de *$${amount}* para *${metadata.customerName}*?`, [
          { id: 'yes', title: 'SÍ ✅' },
          { id: 'no', title: 'NO ❌' }
        ]);
      }

      // VENTA CONTEXTUAL: Captura de Cantidad
      else if (step === 'awaiting_contextual_product_qty') {
        const qty = parseInt(text.replace(/[^0-9]/g, ''));
        if (isNaN(qty) || qty <= 0) {
          await sendWhatsAppMessage(from, "❌ Envía un número válido para la cantidad.");
          return new Response('OK', { status: 200 });
        }
        
        const total = qty * metadata.price;
        await supabase.from('registration_states').update({ 
          step: 'awaiting_confirmation', 
          metadata: { ...metadata, qty, total, type: 'sale' } 
        }).eq('whatsapp_number', from);
        
        await sendWhatsAppButtons(from, `📦 *Confirmar Venta*\n\nProducto: ${metadata.productName}\nCantidad: ${qty}\nTOTAL: *$${total}*\n\n¿Es correcto?`, [
          { id: 'yes', title: 'SÍ ✅' },
          { id: 'no', title: 'NO ❌' }
        ]);
      }
      
      // ESTADO: Creación de Tienda Adicional (DUEÑO)
      else if (step === 'awaiting_new_store_name_creation') {
        const newStoreName = text.trim();
        const { data: newStore, error } = await supabase.from('stores').insert({
          name: newStoreName,
          owner_id: profile.id,
          logo_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(newStoreName)}`,
          description: 'Nueva sucursal'
        }).select().single();

        if (error) {
          await sendWhatsAppMessage(from, `❌ Error al crear la tienda: ${error.message}`);
        } else {
          // Switch context immediately
          await supabase.from('profiles').update({ store_id: newStore.id }).eq('id', profile.id);
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          
          let msg = `✨ *¡Nueva Tienda Creada!* ✨\n\n`;
          msg += `Nombre: *${newStore.name}*\n\n`;
          msg += `Ahora estás gestionando esta sucursal. Cualquier venta o inventario que registres se guardará aquí.`;
          await sendWhatsAppMessage(from, msg);
        }
      }
      
      // ESTADO: Cantidad de Surtido desde Advertencia
      else if (step === 'awaiting_restock_qty_from_warning') {
        const qty = parseInt(text.replace(/[^0-9]/g, ''));
        if (isNaN(qty) || qty <= 0) {
          if (text.toLowerCase() === 'no') {
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, "Surtido cancelado. 👍");
          } else {
            await sendWhatsAppMessage(from, "❌ Por favor, envía la cantidad recibida o escribe 'No'.");
          }
          return new Response('OK', { status: 200 });
        }

        await supabase.from('registration_states').update({
          step: 'awaiting_product_cost',
          metadata: { ...metadata, qty }
        }).eq('whatsapp_number', from);
        
        await sendWhatsAppMessage(from, `📦 *Surtido de ${metadata.productName}*\n\n¿Cuánto te costó cada unidad esta vez?`);
      }
      
      // ESTADO: Nuevo flujo de Surtido Guiado (Nombre)
      else if (step === 'awaiting_restock_name_guided') {
        const productName = text.trim();
        await supabase.from('registration_states').update({
          step: 'awaiting_restock_qty_guided',
          metadata: { productName }
        }).eq('whatsapp_number', from);
        
        await sendWhatsAppMessage(from, `¡Perfecto! ¿Cuántas unidades de *${productName}* te llegaron?`);
      }

      // ESTADO: Nuevo flujo de Surtido Guiado (Cantidad) -> Desencadena el flujo estándar
      else if (step === 'awaiting_restock_qty_guided') {
        const qty = parseInt(text.replace(/[^0-9]/g, ''));
        if (isNaN(qty) || qty <= 0) {
          await sendWhatsAppMessage(from, "❌ Por favor, envía un número válido para la cantidad (ej: 10).");
          return new Response('OK', { status: 200 });
        }

        const productName = metadata.productName;
        const { data: allProds } = await supabase.from('products').select('*').eq('store_id', profile.store_id).eq('is_active', true);
        
        // Reutilizamos la lógica del parser para encontrar similares
        // Nota: En una refactorización ideal, esto estaría en un ayudante compartido
        const input = productName.toLowerCase();
        const inputStem = input.length > 3 && input.endsWith('s') ? input.slice(0, -1) : input;
        
        const similar = allProds?.find(p => {
          const dbName = p.name.toLowerCase();
          const dbStem = dbName.length > 3 && dbName.endsWith('s') ? dbName.slice(0, -1) : dbName;
          return dbName.includes(input) || input.includes(dbName) || dbName.includes(inputStem) || inputStem.includes(dbName) || dbStem.includes(input);
        });

        if (similar) {
          if (similar.name.toLowerCase() === productName.toLowerCase()) {
            await supabase.from('registration_states').update({
              step: 'awaiting_product_cost',
              metadata: { productId: similar.id, qty, productName: similar.name, unit: similar.unit_of_measure }
            }).eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `📦 *Surtido: ${similar.name}*\n\n¿Cuánto te costó cada ${similar.unit_of_measure || 'unidad'} esta vez? (Costo anterior: $${similar.last_cost_price || 0})`);
          } else {
            await supabase.from('registration_states').update({
              step: 'awaiting_similarity_confirmation',
              metadata: { productId: similar.id, qty, productName: similar.name, newName: productName, unit: similar.unit_of_measure }
            }).eq('whatsapp_number', from);
            await sendWhatsAppButtons(from, `🔍 *He encontrado "${similar.name}"*\n\n¿Es el mismo producto que "${productName}"?`, [
              { id: 'yes', title: 'SÍ ✅' },
              { id: 'no', title: 'NO ❌' }
            ]);
          }
        } else {
          await supabase.from('registration_states').update({
            step: 'awaiting_new_product_details',
            metadata: { productName, qty }
          }).eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, `✨ *¡Nuevo Producto!* ✨\n\nNo encontré "${productName}" en tu inventario.\n\nPor favor, dime:\n1. ¿Cuánto te costó?\n2. ¿A cuánto lo venderás?\n\n(Ejemplo: 12 y 20)`);
        }
      }

      // ESTADO: Costo de Producto
      else if (step === 'awaiting_product_cost') {
        const cost = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(cost)) {
          await sendWhatsAppMessage(from, "❌ Envía solo el número del costo (ej: 12.50)");
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
            await notifyOwner(profile.store_id, `📢 *Nueva Aprobación Pendiente*\n\n*${profile.full_name}* ha registrado un *Surtido* de +${metadata.qty} unidades para *${metadata.productName}*.`);
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `⏳ *Surtido Pendiente*\n\nTu registro de +${metadata.qty} unidades de *${metadata.productName}* ha sido enviado para aprobación del dueño.`);
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
      }

      // ESTADO: Detalles de Producto Nuevo
      else if (step === 'awaiting_new_product_details') {
        const prices = text.match(/\d+(\.\d+)?/g);
        if (!prices || prices.length < 2) {
          await sendWhatsAppMessage(from, "❌ Necesito los 2 precios (Costo y Venta). Ejemplo: '10 y 15'");
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
            await notifyOwner(profile.store_id, `📢 *Nueva Aprobación Pendiente*\n\n*${profile.full_name}* quiere dar de alta un *Producto Nuevo*: *${metadata.productName}*.`);
            await supabase.from('registration_states').delete().eq('whatsapp_number', from);
            await sendWhatsAppMessage(from, `⏳ *Producto Nuevo Pendiente*\n\nEl registro de *${metadata.productName}* ha sido enviado para aprobación del dueño.`);
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
            await sendWhatsAppMessage(from, `✅ *¡Producto Registrado!*\n\n${prod.name}\nCosto: $${cost}\nVenta: $${sale}\nStock: ${metadata.qty}`);
          }
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

            // Alerta de Stock Bajo al Dueño
            await checkAndNotifyLowStock(profile.store_id, metadata.productId);
            
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

          // Alerta de Stock Bajo al Dueño (Para cada item del ticket)
          for (const item of metadata.items) {
            await checkAndNotifyLowStock(profile.store_id, item.productId);
          }

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
      else if (step === 'awaiting_similarity_confirmation') {
        if (isPositive) {
          await supabase.from('registration_states').update({
            step: 'awaiting_product_cost',
            metadata: { ...metadata }
          }).eq('whatsapp_number', from);
          
          await sendWhatsAppMessage(from, `📦 *Surtido de ${metadata.productName}*\n\n¿Cuánto te costó cada ${metadata.unit || 'unidad'} esta vez?`);
        } else if (isNegative) {
          await supabase.from('registration_states').update({
            step: 'awaiting_new_product_details',
            metadata: { productName: metadata.newName, qty: metadata.qty }
          }).eq('whatsapp_number', from);
          
          await sendWhatsAppMessage(from, `✨ *¡Nuevo Producto!* ✨\n\nRegistrando "${metadata.newName}".\n\nPor favor, dime:\n1. ¿Cuánto te costó?\n2. ¿A cuánto lo venderás?\n\n(Ejemplo: 12 y 20)`);
        } else {
          await sendWhatsAppButtons(from, `🔍 *¿Es el mismo producto?*\n\n¿Es "${metadata.productName}" lo mismo que "${metadata.newName}"?`, [
            { id: 'yes', title: 'SÍ ✅' },
            { id: 'no', title: 'NO ❌' }
          ]);
        }
      }
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
                  await notifyOwner(profile.store_id, `📢 *Nueva Aprobación Pendiente*\n\n*${profile.full_name}* ha registrado un *Ajuste de Auditoría* para *${metadata.names[idx]}* (Diferencia: ${diff}).`);
                }
              } else {
                await supabase.from('products').update({ current_stock: actual }).eq('id', metadata.productsIds[idx]);
                const diff = actual - metadata.stocks[idx];
                if (diff !== 0) await supabase.from('transactions').insert({ store_id: profile.store_id, product_id: metadata.productsIds[idx], type: 'correction', quantity_change: diff, notes: 'Auditoría' });
              }
            }
            const nextIdx = idx + 1;
            if (nextIdx < metadata.productsIds.length) {
              const nextName = metadata.names[nextIdx];
              await supabase.from('registration_states').update({ metadata: { ...metadata, currentIndex: nextIdx } }).eq('whatsapp_number', from);
              await sendWhatsAppMessage(from, `*Producto: ${nextName}*\n¿Cuántos hay?`);
            } else {
              await supabase.from('registration_states').delete().eq('whatsapp_number', from);
              const msg = profile.role === 'employee' ? "🏁 Conteo finalizado. Los ajustes han sido enviados para aprobación." : "🏁 Auditoría terminada. Stock actualizado.";
              await sendWhatsAppMessage(from, msg);
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
                  step: 'awaiting_restock_qty_from_warning', 
                  metadata: { productId: tx.product_id, productName: prod.name } 
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

      // ESTADO: Confirmación de Ajuste de Costo Directo
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
            await notifyOwner(profile.store_id, `📢 *Nueva Aprobación Pendiente*\n\n*${profile.full_name}* solicita cambiar el *Costo* de *${metadata.productName}* a $${metadata.newCost}.`);
            await sendWhatsAppMessage(from, `⏳ *Ajuste de Costo Pendiente*\n\nSe ha enviado la solicitud para cambiar el costo de *${metadata.productName}* a $${metadata.newCost}.`);
          } else {
            await supabase.from('products').update({ last_cost_price: metadata.newCost }).eq('id', metadata.productId);
            await sendWhatsAppMessage(from, `✅ *Costo Actualizado*\n\nEl nuevo costo para *${metadata.productName}* es $${metadata.newCost}.`);
          }
        } else {
          await sendWhatsAppMessage(from, "Ajuste cancelado. ❌");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmación de Ajuste de Precio de Venta Directo
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
            await notifyOwner(profile.store_id, `📢 *Nueva Aprobación Pendiente*\n\n*${profile.full_name}* solicita cambiar el *Precio de Venta* de *${metadata.productName}* a $${metadata.newPrice}.`);
            await sendWhatsAppMessage(from, `⏳ *Ajuste de Precio Pendiente*\n\nSe ha enviado la solicitud para cambiar el precio de *${metadata.productName}* a $${metadata.newPrice}.`);
          } else {
            await supabase.from('products').update({ base_price: metadata.newPrice }).eq('id', metadata.productId);
            await sendWhatsAppMessage(from, `✅ *Precio de Venta Actualizado*\n\nEl nuevo precio para *${metadata.productName}* es $${metadata.newPrice}.`);
          }
        } else {
          await sendWhatsAppMessage(from, "Ajuste cancelado. ❌");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: Confirmación de Anulación (Undo)
      else if (step === 'awaiting_undo_confirmation') {
        if (buttonId === 'confirm_undo') {
          if (metadata.type === 'activity_log') {
            await supabase.from('activity_logs').delete().eq('id', metadata.id);
            await sendWhatsAppMessage(from, "✅ *Actividad Borrada*\n\nEl reporte ha sido eliminado correctamente.");
          } else {
            // Modo Inventario: Anular Transacción
            const { data: tx } = await supabase.from('transactions').select('*').eq('id', metadata.id).single();
            if (tx) {
              // 1. Revertir Stock
              await supabase.rpc('increment_stock', {
                row_id: tx.product_id,
                amount: Math.abs(tx.quantity_change)
              });
              // 2. Marcar como anulada
              await supabase.from('transactions').update({ is_voided: true }).eq('id', tx.id);
              // 3. Crear registro de reversa
              await supabase.from('transactions').insert({
                store_id: profile.store_id,
                product_id: tx.product_id,
                type: 'void',
                quantity_change: Math.abs(tx.quantity_change),
                total_amount: tx.total_amount,
                notes: `ANULACIÓN DESDE WHATSAPP (Usuario: ${profile.full_name})`
              });
              await sendWhatsAppMessage(from, `✅ *Venta Anulada*\n\nSe han regresado las unidades al inventario.`);
            }
          }
        } else {
          await sendWhatsAppMessage(from, "Anulación cancelada. ❌");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
        return new Response('OK', { status: 200 });
      }

      // ESTADO: Confirmación de Abono a Deuda (Ledgers)
      else if (step === 'awaiting_payment_ledgers_confirmation') {
        if (isPositive) {
          const { customerName, amount } = metadata;
          
          // 1. Buscar al deudor (ignora mayúsculas/minúsculas)
          const { data: ledger } = await supabase
            .from('fiado_ledgers')
            .select('*')
            .eq('store_id', profile.store_id)
            .ilike('customer_name', customerName)
            .maybeSingle();

          if (!ledger) {
            await sendWhatsAppMessage(from, `❌ No encontré a ningún deudor llamado "${customerName}".`);
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

            // 3. Registrar transacción de pago para Auditoría y Corte de Caja
            await supabase.from('transactions').insert({
              store_id: profile.store_id,
              type: 'fiado_payment',
              quantity_change: 0,
              total_amount: amount,
              amount_received: amount,
              customer_id: ledger.id,
              notes: `Abono vía WhatsApp: ${ledger.customer_name}`
            });

            await sendWhatsAppMessage(from, `✅ *Abono Registrado*\n\nCliente: ${ledger.customer_name}\nRecibido: $${amount}\nSaldo pendiente: *$${newBalance.toFixed(2)}*`);
          }
        } else {
          await sendWhatsAppMessage(from, "Abono cancelado. ❌");
        }
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
      }

      // ESTADO: REPORTES DE ACTIVIDAD (CAPTURA DE EVIDENCIA)
      else if (step === 'awaiting_activity_evidence') {
        if (message.type === 'image' && metadata.logId) {
          const publicUrl = await downloadAndUploadImage(message.image.id, profile.store_id, profile.id);
          if (publicUrl) {
            await supabase.from('activity_evidences').insert({
              activity_log_id: metadata.logId,
              image_url: publicUrl,
              media_id_whatsapp: message.image.id
            });
            await sendWhatsAppButtons(from, "✅ ¡Imagen recibida!\n\n¿Deseas enviar otra foto o ya terminaste?", [
              { id: 'add_more', title: 'OTRA FOTO 📸' },
              { id: 'finish_report', title: 'FINALIZAR ✅' }
            ]);
          } else {
            await sendWhatsAppMessage(from, "❌ Hubo un problema guardando la foto. Intenta de nuevo.");
          }
        } 
        else if (normalized === 'finalizar' || buttonId === 'finish_report') {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
          await sendWhatsAppMessage(from, "🏁 *Reporte Finalizado*\n\nGracias por tu informe. Ya está disponible para el dueño.");
          
          // Notificar al Dueño (Si el que reportó no es el dueño)
          if (profile.role !== 'owner') {
            await notifyOwner(profile.store_id, `✅ *REPORTE COMPLETADO*\n\n*${profile.full_name}* ha finalizado su reporte:\n"${metadata.description || 'Sin descripción'}"`);
          }
        }
        else {
          await sendWhatsAppMessage(from, "📸 Por favor, envía una foto como evidencia o toca 'Finalizar'.");
        }
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // B. COMANDOS NUEVOS
    if (profile) {
      // 0. GENERACIÓN DE MAGIC LINK (Comando "Link")
      if (normalized === 'link' || normalized === 'enlace') {
        if (profile.role === 'owner') {
          const magicLink = `https://shadow-pulsar.vercel.app/?s=${profile.store_id}&u=${profile.id}`;
          await sendWhatsAppMessage(from, `🔗 *Tu Panel de Control*\n\nHaz clic aquí para acceder directamente:\n\n${magicLink}\n\n_Recuerda que este enlace es personal._`);
        } else {
          await sendWhatsAppMessage(from, "🔒 *Acceso Restringido*\n\nEsta función es solo para dueños. Tu cuenta está configurada para reportar actividades de equipo.");
        }
        await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
        return new Response('OK', { status: 200 });
      }

      // 0.1 GENERACIÓN DE CÓDIGO DE INVITACIÓN (Comando "Invitar")
      if (normalized === 'invitar' || normalized.includes('invitacion')) {
        if (profile.role === 'owner') {
          const randomCode = `INV-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
          await supabase.from('invite_codes').insert({
            code: randomCode,
            max_uses: 5,
            metadata: { role: 'employee', store_id: profile.store_id }
          });
          await sendWhatsAppMessage(from, `🎟️ *Nueva Invitación*\n\nPasa este código a tu empleado:\n\n*${randomCode}*\n\nDile que lo escriba aquí para unirse a tu equipo.`);
        } else {
          await sendWhatsAppMessage(from, "🔒 *Función solo para Dueños*\n\nSolo el administrador de la cuenta puede invitar a nuevos empleados.");
        }
        await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
        return new Response('OK', { status: 200 });
      }

      // 0.2 MENÚ DE AYUDA (Específico para Servicios)
      if (normalized === 'ayuda' || normalized === 'menu' || normalized === 'comandos') {
        if (store?.business_type === 'activity_logs') {
          if (profile.role === 'owner') {
            let help = "❓ *AYUDA: MODO BITÁCORA*\n\n";
            help += "• *Reportar:* Describe tu actividad (ej: 'Instalación de red') y envía fotos.\n";
            help += "• *Cambiar:* Para saltar a tu otra empresa.\n";
            help += "• *Invitar:* Genera códigos para tus empleados.\n";
            help += "• *Link:* Acceso al Dashboard y reportes PDF.\n\n";
            help += "_Cualquier texto largo que envíes iniciará un nuevo reporte._";
            await sendWhatsAppMessage(from, help);
          } else {
            await sendWhatsAppMessage(from, "📝 *Tu función:* Reportar actividades escribiendo lo que hiciste y enviando fotos de evidencia.");
          }
          await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
          return new Response('OK', { status: 200 });
        }
        // Si no es servicios, dejamos que pase al parser de inventario (si aplica)
      }

      // 0.3 COMANDO ANULAR / BORRAR (Deshacer última acción)
      if (normalized === 'anular' || normalized === 'borrar') {
         const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
         
         if (store?.business_type === 'activity_logs') {
            const { data: lastLog } = await supabase.from('activity_logs')
              .select('*')
              .eq('performer_id', profile.id)
              .gte('created_at', tenMinutesAgo)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (lastLog) {
              await supabase.from('registration_states').upsert({
                whatsapp_number: from,
                step: 'awaiting_undo_confirmation',
                metadata: { type: 'activity_log', id: lastLog.id, description: lastLog.description }
              });
              const buttons = [
                { id: 'confirm_undo', title: 'Sí, borrar' },
                { id: 'cancel_undo', title: 'No, dejar así' }
              ];
              await sendWhatsAppButtons(from, `⚠️ *¿Confirmas borrar esta actividad?*\n\n"${lastLog.description}"\n\n_Realizada hace unos minutos._`, buttons);
            } else {
              await sendWhatsAppMessage(from, "❌ No encontré ninguna actividad reciente tuya para borrar (Límite: 10 min).");
            }
         } else {
            // Modo Inventario
            const { data: lastTx } = await supabase.from('transactions')
              .select('*, products(name)')
              .eq('store_id', profile.store_id)
              .eq('type', 'sale')
              .eq('is_voided', false)
              .gte('created_at', tenMinutesAgo)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (lastTx) {
              await supabase.from('registration_states').upsert({
                whatsapp_number: from,
                step: 'awaiting_undo_confirmation',
                metadata: { type: 'transaction', id: lastTx.id, description: `${lastTx.products?.name}: ${Math.abs(lastTx.quantity_change)}` }
              });
              const buttons = [
                { id: 'confirm_undo', title: 'Sí, anular venta' },
                { id: 'cancel_undo', title: 'No, dejar así' }
              ];
              await sendWhatsAppButtons(from, `⚠️ *¿Confirmas anular esta venta?*\n\n"${lastTx.products?.name || 'Venta'}" (${Math.abs(lastTx.quantity_change)} unidades)\n\n_Monto: $${lastTx.total_amount}_`, buttons);
            } else {
              await sendWhatsAppMessage(from, "❌ No encontré ninguna venta reciente tuya para anular (Límite: 10 min).");
            }
         }
         await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
         return new Response('OK', { status: 200 });
      }

      // LÓGICA DE REPORTES DE ACTIVIDAD (Iniciado por texto)
      if (store?.business_type === 'activity_logs') {
        if (text.length > 5) {
          const { data: log } = await supabase.from('activity_logs').insert({
            store_id: profile.store_id,
            performer_id: profile.id,
            description: text
          }).select().single();

          if (log) {
            await supabase.from('registration_states').upsert({
              whatsapp_number: from,
              step: 'awaiting_activity_evidence',
              metadata: { logId: log.id, description: text }
            });
            await sendWhatsAppMessage(from, `📝 *Reporte Iniciado*\n\nActividad: "${text}"\n\nPor favor, envía las fotos de evidencia una por una.`);
            return new Response('OK', { status: 200 });
          }
        } else {
          await sendWhatsAppMessage(from, "👋 ¡Hola! Para reportar una actividad, descríbela detalladamente (más de 5 letras).");
          return new Response('OK', { status: 200 });
        }
      }

      console.time('executeCommand');
      const res = await executeCommand(text, supabase, profile.store_id, profile.role, from, profile.id);
      console.timeEnd('executeCommand');
      
      if (res.nextStep) {
        await supabase.from('registration_states').upsert({ whatsapp_number: from, step: res.nextStep, metadata: res.metadata });
      }

      if (res.responseText) {
        if (['awaiting_confirmation', 'awaiting_bulk_confirmation', 'awaiting_void_confirmation', 'awaiting_cost_confirmation', 'awaiting_price_confirmation', 'awaiting_payment_ledgers_confirmation'].includes(res.nextStep || '')) {
          await sendWhatsAppButtons(from, res.responseText, [{ id: 'yes', title: 'SÍ ✅' }, { id: 'no', title: 'NO ❌' }]);
        } else {
          await sendWhatsAppMessage(from, res.responseText);
        }
      } else {
        await sendWhatsAppMessage(from, "🤔 No entendí. Prueba con: 'Inventario' o una lista como '2 cocas'.");
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // C. CÓDIGO INICIAL (Validación dinámica con Base de Datos)
    const { data: invite } = await supabase
      .from('invite_codes')
      .select('*')
      .eq('code', normalized.toUpperCase())
      .eq('is_active', true)
      .maybeSingle();

    if (invite) {
      // 1. Verificar Expiración
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        await sendWhatsAppMessage(from, "❌ Este código de invitación ha expirado. Por favor, solicita uno nuevo al dueño de la tienda.");
        return new Response('OK', { status: 200 });
      }

      // 2. Verificar Usos
      if (invite.current_uses >= invite.max_uses) {
        await sendWhatsAppMessage(from, "❌ Este código ya ha sido utilizado el máximo de veces permitido.");
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
          full_name: 'Empleado' // Se puede pedir después o dejar genérico
        });

        // Incrementar uso del código
        await supabase.from('invite_codes')
          .update({ current_uses: invite.current_uses + 1 })
          .eq('code', invite.code);

        // Obtener info de la tienda para la bienvenida
        const { data: targetStore } = await supabase.from('stores').select('name, business_type').eq('id', metadata.store_id).single();
        
        const welcomeMsg = targetStore?.business_type === 'activity_logs'
          ? `✅ ¡Bienvenido! Has sido registrado como empleado en *${targetStore.name}* (Modo Bitácora).\n\nYa puedes reportar tus tareas describiéndolas aquí y enviando fotos de evidencia.`
          : `✅ ¡Bienvenido! Has sido registrado como empleado en *${targetStore.name}* (Modo Inventario).\n\nYa puedes registrar ventas escribiendo algo como: "2 cocas" o "Fiado Maria: 1 gansito".`;
        
        await sendWhatsAppMessage(from, welcomeMsg);

        // Notificar al Dueño
        const { data: owner } = await supabase.from('profiles').select('whatsapp_number').eq('store_id', metadata.store_id).eq('role', 'owner').maybeSingle();
        if (owner) {
          await sendWhatsAppMessage(owner.whatsapp_number, `📢 *Aviso:* Un nuevo empleado (Terminación ..${from.slice(-4)}) se ha unido a tu tienda usando el código *${invite.code}*.`);
        }
      } 
      // 4. Flujo para Dueños Nuevos (Sin metadata de empleado)
      else {
        await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_store_name' });
        await sendWhatsAppMessage(from, "¡Código aceptado! ✅ ¿Cómo se llama tu negocio?");
      }

      await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
      return new Response('OK', { status: 200 });
    }

    // Código genérico legado (opcional mantener o quitar)
    if (normalized === 'tiendita2026') {
      await supabase.from('registration_states').upsert({ whatsapp_number: from, step: 'awaiting_store_name' });
      await sendWhatsAppMessage(from, "¡Código aceptado! ✅ ¿Cómo se llama tu negocio?");
      return new Response('OK', { status: 200 });
    }

    await supabase.from('webhook_idempotency').update({ status: 'completed' }).eq('id', messageId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error(`[CRITICAL ERROR]`, err);
    return new Response('OK', { status: 200 });
  }
});
