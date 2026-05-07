import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"
import { handleCommand, executeCommand } from './parser.ts';
import { Templates } from './templates.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID');

async function sendWhatsAppMessage(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
}

serve(async (req) => {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      if (url.searchParams.get('hub.verify_token') === 'shadow_pulsar_secret') {
        return new Response(url.searchParams.get('hub.challenge'));
      }
      return new Response("Invalid token", { status: 403 });
    }

    const payload = await req.json();
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message?.text?.body) {
      const from = message.from;
      const body = message.text.body;

      if (body.toLowerCase() === 'reset') {
        await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        await sendWhatsAppMessage(from, Templates.Global.reset);
        return new Response("OK", { status: 200 });
      }

      // 1. Obtener Perfil
      let { data: profile } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).maybeSingle();
      if (!profile) {
        const { data: newUser } = await supabase.from('profiles').insert({ 
          whatsapp_number: from, 
          role: 'employee', // Por defecto empleado hasta que valide código
          full_name: 'Usuario'
        }).select().single();
        profile = newUser;
      }

      // 2. Obtener Estado Conversacional
      const { data: convState } = await supabase.from('registration_states').select('*').eq('whatsapp_number', from).maybeSingle();

      // 3. Procesar Comando (Firma correcta)
      const convRes = await handleCommand(body, profile.store_id, supabase, profile.full_name || 'Amigo', convState);

      if (convRes && convRes.responseText) {
        const meta = convRes.metadata;

        // EJECUCIONES EN DB
        if (meta?.intent === 'CREATE_NEW_BRANCH') {
          // Hardcode de seguridad para el usuario principal
          const ownerId = (from === '5215513531114') ? 'cc04e6ce-7abf-4926-a3aa-f15166422e32' : profile?.id;
          
          const { data: newStore, error: storeError } = await supabase.from('stores').insert({
            name: meta.name,
            owner_id: ownerId,
            logo_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(meta.name)}`
          }).select().single();

          if (storeError) {
             await sendWhatsAppMessage(from, Templates.Global.errorDb(storeError.message));
          } else if (newStore) {
             await supabase.from('profiles').update({ 
               store_id: newStore.id, 
               role: 'owner',
               full_name: meta.ownerName || profile.full_name // Usamos el nombre capturado
             }).eq('id', profile.id);
             
             // Si se usó un código de invitación, incrementamos su uso
             if (meta.inviteCode) {
               const { data: codeData } = await supabase.from('invite_codes').select('current_uses').eq('code', meta.inviteCode).single();
               if (codeData) {
                 await supabase.from('invite_codes').update({ current_uses: (codeData.current_uses || 0) + 1 }).eq('code', meta.inviteCode);
               }
             }

             // Enviamos el mensaje de éxito y la invitación a añadir el primer producto
             await sendWhatsAppMessage(from, Templates.Onboarding.storeCreatedSuccess(newStore.name));
          }
        }

        // 2. CREACIÓN DE PRODUCTOS
        if (meta?.intent === 'CREATE_PRODUCT') {
          const { data: newProd } = await supabase.from('products').insert({
            store_id: profile.store_id,
            name: meta.name,
            base_price: meta.price,
            last_cost_price: meta.cost,
            current_stock: meta.qty,
            unit_of_measure: meta.unit || 'pza'
          }).select('id').single();
          if (newProd && meta.qty > 0) {
            await supabase.from('transactions').insert({ 
              store_id: profile.store_id, 
              product_id: newProd.id, 
              type: 'restock', 
              quantity_change: meta.qty, 
              unit_price: meta.cost 
            });
          }
        }

        // 3. RESURTIDOS
        if (!convRes.nextStep && meta?.intent === 'RESTOCK') {
          await supabase.rpc('increment_stock', { row_id: meta.productId, amount: meta.qty });
          await supabase.from('transactions').insert({ 
            store_id: profile.store_id, 
            product_id: meta.productId, 
            type: 'restock', 
            quantity_change: meta.qty 
          });
        }

        // 4. VENTAS
        if (!convRes.nextStep && meta?.intent === 'PROCESS_SALE') {
          const items = meta.items || [{ productId: meta.productId, qty: meta.qty, lineTotal: meta.total }];
          
          for (const item of items) {
            await supabase.rpc('increment_stock', { row_id: item.productId, amount: -item.qty });
            await supabase.from('transactions').insert({
              store_id: profile.store_id,
              product_id: item.productId,
              type: 'sale',
              quantity_change: -item.qty,
              total_amount: item.lineTotal,
              amount_received: item.lineTotal // Para multi-item asumimos pago completo proporcional por linea si no hay un amountReceived global
            });
          }
          
          // Si el total no se cubrió completo y hay deuda
          if (meta.debt && meta.debt > 0 && meta.customerName) {
            const { data: ledger } = await supabase.from('fiado_ledgers').select('*').eq('store_id', profile.store_id).ilike('customer_name', `%${meta.customerName}%`).maybeSingle();
            if (ledger) {
              await supabase.from('fiado_ledgers').update({ current_balance: ledger.current_balance + meta.debt }).eq('id', ledger.id);
            } else {
              await supabase.from('fiado_ledgers').insert({ store_id: profile.store_id, customer_name: meta.customerName, current_balance: meta.debt });
            }
          }
        }

        // 5. ABONOS
        if (!convRes.nextStep && meta?.intent === 'PROCESS_ABONO') {
          await supabase.from('transactions').insert({
            store_id: profile.store_id,
            type: 'fiado_payment',
            quantity_change: 0,
            total_amount: meta.amount,
            amount_received: meta.amount,
            notes: `Abono de ${meta.customerName}`
          });
          const { data: ledger } = await supabase.from('fiado_ledgers').select('current_balance').eq('id', meta.customerId).single();
          if (ledger) {
            await supabase.from('fiado_ledgers').update({ current_balance: ledger.current_balance - meta.amount }).eq('id', meta.customerId);
          }
        }

        // 6. CORTE DE CAJA
        if (!convRes.nextStep && meta?.intent === 'PROCESS_CORTE') {
          await supabase.from('cash_snapshots').insert({
            store_id: profile.store_id,
            started_at: meta.since,
            expected_cash: meta.expected,
            actual_cash: meta.physical,
            status: 'closed'
          });
        }

        // 7. ANULACIONES
        if (!convRes.nextStep && meta?.intent === 'PROCESS_VOID') {
          await supabase.from('transactions').update({ is_voided: true }).eq('id', meta.transactionId);
          await supabase.rpc('increment_stock', { row_id: meta.productId, amount: meta.qty });
          await supabase.from('transactions').insert({ 
            store_id: profile.store_id, 
            product_id: meta.productId, 
            type: 'void', 
            quantity_change: meta.qty, 
            notes: `Anulación de venta ID: ${meta.transactionId}` 
          });
        }

        // 8. VINCULACIÓN DE DUEÑO
        if (!convRes.nextStep && meta?.intent === 'LINK_OWNER_CONFIRMED') {
          await supabase.from('stores').update({ owner_id: profile.id }).eq('id', meta.storeId);
          await supabase.from('profiles').update({ store_id: meta.storeId }).eq('id', profile.id);
          await sendWhatsAppMessage(from, Templates.Admin.linkStoreConfirmedOwner(meta.storeName));
        }

        // GUARDAR ESTADO PARA LA SIGUIENTE PREGUNTA
        if (convRes.nextStep) {
          await supabase.from('registration_states').upsert({ 
            whatsapp_number: from, 
            step: convRes.nextStep, 
            metadata: meta 
          });
        } else {
          await supabase.from('registration_states').delete().eq('whatsapp_number', from);
        }

        // ENVIAR RESPUESTA FINAL (Omitimos el mensaje base si es creación de tienda, ya que enviamos el éxito arriba)
        if (meta?.intent !== 'CREATE_NEW_BRANCH') {
          await sendWhatsAppMessage(from, convRes.responseText);
        }
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("GLOBAL ERROR:", err.message);
    return new Response("Error", { status: 200 });
  }
});
