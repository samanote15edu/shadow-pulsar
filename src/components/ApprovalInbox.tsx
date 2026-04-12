import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';

interface ApprovalRequest {
  id: string;
  type: string;
  product_id: string;
  quantity: number;
  new_value: number;
  old_value: number;
  requester_name: string;
  created_at: string;
  status: string;
  metadata: any;
  products?: {
    name: string;
  };
}

export default function ApprovalInbox() {
  const { selectedStore } = useStoreContext();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchApprovals = async () => {
    if (!selectedStore) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_approvals')
      .select('*, products(name)')
      .eq('store_id', selectedStore.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setApprovals(data as any);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchApprovals();
  }, [selectedStore]);

  const handleAction = async (approval: ApprovalRequest, action: 'approved' | 'rejected') => {
    setProcessingId(approval.id);
    try {
      if (action === 'approved') {
        const { type, product_id, quantity, new_value, metadata } = approval;

        if (type === 'restock') {
          await supabase.from('products').update({ last_cost_price: new_value }).eq('id', product_id);
          await supabase.rpc('increment_stock', { row_id: product_id, amount: quantity });
          await supabase.from('transactions').insert({
            store_id: selectedStore?.id,
            product_id,
            type: 'restock',
            quantity_change: quantity,
            unit_price: new_value,
            total_amount: new_value * quantity,
            notes: `Aprobado por dueño. Solicitado por: ${approval.requester_name}`
          });
        } 
        else if (type === 'adjustment') {
          await supabase.from('products').update({ current_stock: new_value }).eq('id', product_id);
          await supabase.from('transactions').insert({
            store_id: selectedStore?.id,
            product_id,
            type: 'correction',
            quantity_change: quantity,
            notes: `Ajuste aprobado. Solicitado por: ${approval.requester_name}`
          });
        }
        else if (type === 'cost_change') {
          await supabase.from('products').update({ last_cost_price: new_value }).eq('id', product_id);
        }
        else if (type === 'price_change') {
          await supabase.from('products').update({ base_price: new_value }).eq('id', product_id);
        }
        else if (type === 'new_product' && metadata) {
          const { data: prod } = await supabase.from('products').insert({
            store_id: selectedStore?.id,
            name: metadata.productName,
            base_price: metadata.base_price,
            last_cost_price: new_value,
            current_stock: quantity
          }).select().single();
          
          if (prod) {
            await supabase.from('transactions').insert({
              store_id: selectedStore?.id,
              product_id: prod.id,
              type: 'restock',
              quantity_change: quantity,
              unit_price: new_value,
              total_amount: new_value * quantity,
              notes: `Nuevo producto aprobado. Solicitado por: ${approval.requester_name}`
            });
          }
        }
      }

      await supabase.from('inventory_approvals').update({ 
        status: action,
        resolved_at: new Date().toISOString()
      }).eq('id', approval.id);

      setApprovals(prev => prev.filter(a => a.id !== approval.id));
    } catch (err) {
      console.error('Error procesando aprobación:', err);
      alert('Hubo un error al procesar la solicitud.');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="p-4 text-center text-slate-400">Cargando solicitudes...</div>;

  if (approvals.length === 0) return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-12 text-center">
      <div className="text-4xl mb-4">✨</div>
      <h3 className="text-lg font-bold text-slate-300">Todo al día</h3>
      <p className="text-slate-500 text-sm">No tienes aprobaciones pendientes de inventario.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {approvals.map(app => (
        <div key={app.id} className="glass-pane rounded-2xl p-4 border border-slate-800 hover:border-sky-500/30 transition-all">
          <div className="flex justify-between items-start mb-3">
            <div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter ${
                app.type === 'restock' ? 'bg-emerald-500/10 text-emerald-400' :
                app.type === 'new_product' ? 'bg-sky-500/10 text-sky-400' :
                'bg-amber-500/10 text-amber-400'
              }`}>
                {app.type.replace('_', ' ')}
              </span>
              <h3 className="text-lg font-bold mt-1">{app.products?.name || app.metadata?.productName || 'Producto Nuevo'}</h3>
              <p className="text-slate-500 text-xs">Solicitado por: <span className="text-slate-300">{app.requester_name}</span></p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase">{new Date(app.created_at).toLocaleDateString()}</p>
              <p className="text-[10px] text-slate-500 uppercase">{new Date(app.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>

          <div className="bg-slate-950/50 rounded-xl p-3 mb-4 grid grid-cols-2 gap-4">
            {app.quantity !== null && (
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Cantidad</p>
                <p className="text-sm font-bold text-sky-400">{app.quantity > 0 ? '+' : ''}{app.quantity}</p>
              </div>
            )}
            {app.new_value !== null && (
              <div>
                <p className="text-[10px] text-slate-500 uppercase">{app.type.includes('cost') || app.type === 'restock' || app.type === 'new_product' ? 'Costo' : 'Precio'}</p>
                <p className="text-sm font-bold text-emerald-400">${app.new_value}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleAction(app, 'approved')}
              disabled={!!processingId}
              className="flex-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 py-2 rounded-xl text-sm font-bold hover:bg-emerald-500/30 transition-all disabled:opacity-50"
            >
              {processingId === app.id ? '...' : 'VALIDAR ✅'}
            </button>
            <button
              onClick={() => handleAction(app, 'rejected')}
              disabled={!!processingId}
              className="px-4 bg-red-500/10 text-red-500 border border-red-500/20 py-2 rounded-xl text-sm font-bold hover:bg-red-500/20 transition-all disabled:opacity-50"
            >
              RECHAZAR ❌
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
