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
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <header className="mb-10 max-w-5xl mx-auto">
        <button 
          onClick={() => navigate('/')} 
          className="group flex items-center gap-2 text-sky-400 text-[10px] font-black uppercase tracking-widest mb-6 hover:text-sky-300 transition-colors"
        >
          <span className="text-lg transition-transform group-hover:-translate-x-1">←</span> Volver al Sistema
        </button>
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black bg-gradient-to-r from-white via-sky-300 to-indigo-400 bg-clip-text text-transparent tracking-tighter uppercase italic">
              Auditoría de Inventario
            </h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
              Sincronizado con Reportes de WhatsApp
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-pane rounded-2xl p-4 border border-white/5 min-w-[160px]">
              <p className="text-[9px] uppercase font-black text-slate-500 mb-1 tracking-widest">Impacto Financiero</p>
              <p className={`text-2xl font-black italic ${totalShrinkage < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                ${totalShrinkage.toFixed(2)}
              </p>
            </div>
            <div className="glass-pane rounded-2xl p-4 border border-white/5 min-w-[160px]">
              <p className="text-[9px] uppercase font-black text-slate-500 mb-1 tracking-widest">Total Registros</p>
              <p className="text-2xl font-black text-white italic">
                {audits.length}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        <div className="glass-pane rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 text-slate-400 text-[10px] uppercase font-black tracking-widest">
                  <th className="p-6">Fecha y Hora</th>
                  <th className="p-6">Producto</th>
                  <th className="p-6 text-center">Diferencia</th>
                  <th className="p-6 text-right">Impacto en Costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {audits.length > 0 ? audits.map(a => (
                  <tr key={a.id} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="p-6">
                      <p className="text-xs font-bold text-slate-300">
                        {new Date(a.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {new Date(a.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </td>
                    <td className="p-6">
                      <p className="text-sm font-black text-white uppercase tracking-tight">{a.product}</p>
                    </td>
                    <td className="p-6 text-center">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black ${
                        a.diff < 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        <span className="text-lg leading-none">{a.diff > 0 ? '↑' : '↓'}</span>
                        {Math.abs(a.diff)} {a.diff === 1 || a.diff === -1 ? 'ud' : 'uds'}
                      </div>
                    </td>
                    <td className="p-6 text-right">
                      <p className={`text-sm font-black italic ${
                        a.impact < 0 ? 'text-red-400' : 'text-emerald-400'
                      }`}>
                        {a.impact < 0 ? '-' : '+'}${Math.abs(a.impact).toFixed(2)}
                      </p>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="p-20 text-center">
                      <span className="text-4xl mb-4 block opacity-20">📋</span>
                      <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest italic">
                        No se han encontrado auditorías recientes
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        <footer className="mt-8 text-center">
          <p className="text-slate-600 text-[9px] font-bold uppercase tracking-[0.2em]">
            Shadow Pulsar Intelligence System • 2026
          </p>
        </footer>
      </main>
    </div>
  );
}
