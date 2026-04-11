import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';

export default function InventoryReconciliation() {
  const { selectedStore, loading, userRole } = useStoreContext();
  const navigate = useNavigate();
  const [audits, setAudits] = useState<any[]>([]);
  const [totalShrinkage, setTotalShrinkage] = useState(0);

  useEffect(() => {
    if (!loading && userRole === 'employee') {
      navigate('/');
    }
  }, [loading, userRole, navigate]);

  const fetchData = async () => {
    if (!selectedStore) return;
    const { data } = await supabase.from('transactions').select('*, products(name, last_cost_price)').eq('store_id', selectedStore.id).eq('type', 'correction').ilike('notes', '%Auditoría%').order('created_at', { ascending: false });
    if (data) {
      const mapped = data.map(a => ({
        id: a.id,
        date: a.created_at,
        product: (a as any).products?.name || '?',
        diff: a.quantity_change,
        impact: a.quantity_change * ((a as any).products?.last_cost_price || 0)
      }));
      setAudits(mapped);
      setTotalShrinkage(mapped.reduce((acc, curr) => acc + curr.impact, 0));
    }
  };

  useEffect(() => { if (selectedStore) fetchData(); }, [selectedStore]);

  if (loading) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <header className="mb-8">
        <button onClick={() => navigate('/')} className="text-sky-400 text-xs font-black uppercase mb-4">← Volver</button>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">Reporte de Auditoría</h1>
        <div className={`mt-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] ${totalShrinkage < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          <p className="text-[10px] uppercase font-bold text-slate-500">Impacto Total de Auditorías</p>
          <p className="text-2xl font-black">$ {totalShrinkage.toFixed(2)}</p>
        </div>
      </header>
      <div className="glass-pane rounded-2xl overflow-hidden border border-white/5">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-white/5 border-b border-white/5 text-slate-500 uppercase font-bold">
              <th className="p-4">Fecha</th>
              <th className="p-4">Producto</th>
              <th className="p-4 text-center">Dif.</th>
              <th className="p-4 text-right">Impacto ($)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {audits.map(a => (
              <tr key={a.id} className="hover:bg-white/[0.01]">
                <td className="p-4 text-slate-400">{new Date(a.date).toLocaleDateString()}</td>
                <td className="p-4 font-bold">{a.product}</td>
                <td className="p-4 text-center">
                  <span className={`px-2 py-0.5 rounded ${a.diff < 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    {a.diff > 0 ? '+' : ''}{a.diff}
                  </span>
                </td>
                <td className={`p-4 text-right font-bold ${a.impact < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  $ {a.impact.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
