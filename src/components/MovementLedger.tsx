import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import { downloadCSV } from '../utils/export';

interface Transaction {
  id: string;
  type: string;
  quantity_change: number;
  created_at: string;
  product_name: string;
  unit_price: number;
  total_amount: number;
  amount_received: number;
  notes?: string;
  product_id: string;
  is_voided?: boolean;
  voided_quantity?: number;
  customer_name?: string;
}

const DUMMY_ALL_ACTIVITIES: Transaction[] = [
  { id: 'd1', type: 'sale', quantity_change: -2, created_at: new Date().toISOString(), product_name: 'Refresco Familiar', unit_price: 20, total_amount: 40, amount_received: 40, product_id: 'p1', is_voided: false },
  { id: 'd2', type: 'restock', quantity_change: 24, created_at: new Date().toISOString(), product_name: 'Cerveza Corona', unit_price: 15, total_amount: 0, amount_received: 0, product_id: 'p2', is_voided: false },
  { id: 'd3', type: 'void', quantity_change: -1, created_at: new Date().toISOString(), product_name: 'Leche', unit_price: 25, total_amount: 25, amount_received: 0, notes: 'Error de cobro', product_id: 'p3', is_voided: false },
];

export default function MovementLedger() {
  const { selectedStore, loading, isDemo, userRole } = useStoreContext();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<Transaction[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!loading && userRole === 'employee') {
      navigate('/');
    }
  }, [loading, userRole, navigate]);
  const [hasMore, setHasMore] = useState(true);
  const [isLodingMore, setIsLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const PAGE_SIZE = 20;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchMovements = async (pageToFetch: number, append = false) => {
    if (isDemo) {
      setActivities(DUMMY_ALL_ACTIVITIES);
      setHasMore(false);
      setIsLoadingMore(false);
      return;
    }
    if (!selectedStore) return;
    setIsLoadingMore(true);

    let query = supabase
      .from('transactions')
      .select('*, products(name)')
      .eq('store_id', selectedStore.id)
      .order('created_at', { ascending: false })
      .range(pageToFetch * PAGE_SIZE, (pageToFetch + 1) * PAGE_SIZE - 1);

    if (filterType !== 'all') {
      query = query.eq('type', filterType);
    }

    if (dateRange.start) {
      const start = new Date(dateRange.start + 'T00:00:00').toISOString();
      query = query.gte('created_at', start);
    }
    if (dateRange.end) {
      const end = new Date(dateRange.end + 'T23:59:59').toISOString();
      query = query.lte('created_at', end);
    }

    const { data } = await query;

    if (data) {
      const mapped = data.map(a => ({
        ...a,
        product_name: (a as any).products?.name || (a.type === 'fiado_payment' ? 'Abono de Deuda' : 'Desconocido'),
        customer_name: (a as any).fiado_ledgers?.customer_name || a.customer_name || null
      }));
      setActivities(prev => append ? [...prev, ...mapped] : mapped);
      setHasMore(data.length === PAGE_SIZE);
    }
    setIsLoadingMore(false);
  };

  useEffect(() => {
    setPage(0);
    fetchMovements(0, false);
  }, [selectedStore, filterType, dateRange]);

  const handleNextPage = () => {
    const next = page + 1;
    setPage(next);
    fetchMovements(next, false);
  };

  const handlePrevPage = () => {
    if (page > 0) {
      const prev = page - 1;
      setPage(prev);
      fetchMovements(prev, false);
    }
  };

  const handleExport = () => {
    if (!activities.length) return;
    const exportData = activities.map(a => ({
      Fecha: new Date(a.created_at).toLocaleString(),
      Tipo: a.type,
      Producto: a.product_name,
      Cantidad: a.quantity_change,
      Monto_Total: a.total_amount,
      Cobrado: a.amount_received,
      Info: a.customer_name || a.notes || ''
    }));
    downloadCSV(exportData, 'Historial_Movimientos');
  };

  // Infinite scroll for mobile
  useEffect(() => {
    if (!isMobile || !hasMore || isLodingMore) return;
    
    const handleScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
        const next = page + 1;
        setPage(next);
        fetchMovements(next, true);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('resize', handleScroll);
  }, [isMobile, hasMore, isLodingMore, page]);

  const handleVoid = async (transaction: Transaction) => {
    if (transaction.is_voided) return;
    
    // 1. Ask for reason
    const reason = window.prompt(`¿Motivo de la anulación para ${transaction.product_name}?`);
    if (reason === null) return; 

    // 2. Ask for quantity (Partial void logic)
    const maxToVoid = Math.abs(transaction.quantity_change) - (transaction.voided_quantity || 0);
    let qtyToVoid = maxToVoid;

    if (maxToVoid > 1) {
      const input = window.prompt(`¿Cuántas unidades regresan? (Máximo: ${maxToVoid})`, maxToVoid.toString());
      if (input === null) return;
      qtyToVoid = parseInt(input, 10);
      if (isNaN(qtyToVoid) || qtyToVoid <= 0 || qtyToVoid > maxToVoid) {
        alert('Cantidad inválida');
        return;
      }
    }

    try {
      const newVoidedQty = (transaction.voided_quantity || 0) + qtyToVoid;
      const isFullVoid = newVoidedQty === Math.abs(transaction.quantity_change);

      // 1. Update original transaction (track how many are voided)
      await supabase.from('transactions')
        .update({ 
          voided_quantity: newVoidedQty,
          is_voided: isFullVoid
        })
        .eq('id', transaction.id);

      // 2. Revert stock ONLY for the returned amount
      await supabase.rpc('increment_stock', {
        row_id: transaction.product_id,
        amount: qtyToVoid
      });

      // 3. Create NEW reversal record
      const unitPrice = transaction.unit_price || 0;
      await supabase.from('transactions').insert({ 
        store_id: selectedStore?.id,
        product_id: transaction.product_id,
        type: 'void',
        quantity_change: qtyToVoid,
        total_amount: qtyToVoid * unitPrice,
        notes: `Reversa (${qtyToVoid}/${Math.abs(transaction.quantity_change)}) de: ${transaction.id}. Motivo: ${reason || 'Sin motivo'}`
      });

      fetchMovements(0, false);
    } catch (err) {
      console.error('Error in handleVoid:', err);
      alert('Error al anular');
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <header className="mb-10 max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="flex-1">
          <button 
            onClick={() => navigate('/')} 
            className="group flex items-center gap-2 text-sky-400 text-[10px] font-black uppercase tracking-widest mb-4 hover:text-sky-300 transition-colors"
          >
            ← Volver al Panel
          </button>
          <h1 className="text-4xl font-black bg-gradient-to-r from-white via-sky-300 to-indigo-400 bg-clip-text text-transparent tracking-tighter uppercase italic text-shadow-glow">
            Libro de Movimientos
          </h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2 border-l-2 border-sky-500 pl-3">Bitácora General de Actividad</p>
        </div>

        <div className="flex flex-col gap-3 w-full md:w-auto">
          <button 
            onClick={handleExport}
            className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all mb-2 flex items-center justify-center gap-2 shadow-xl"
          >
            <span className="text-lg">↓</span> Descargar Historial CSV
          </button>

          <div className="flex flex-wrap gap-2">
            <input 
              type="date" 
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-[10px] font-black text-slate-400 uppercase focus:border-sky-500/50 outline-none transition-all"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            />
            <input 
              type="date" 
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-[10px] font-black text-slate-400 uppercase focus:border-sky-500/50 outline-none transition-all"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            />
            <select 
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-[10px] font-black text-sky-400 uppercase tracking-widest appearance-none pr-8 relative"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">TODOS</option>
              <option value="sale">VENTAS</option>
              <option value="fiado_payment">ABONOS</option>
              <option value="restock">SURTIDOS</option>
              <option value="void">ANULADOS</option>
              <option value="correction">AJUSTES</option>
            </select>
          </div>
        </div>
      </header>

      <div className="glass-pane rounded-3xl overflow-hidden border border-white/5 shadow-2xl max-w-5xl mx-auto">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-white/5 bg-white/[0.03]">
                <th className="p-6">Fecha</th>
                <th className="p-6">Tipo de Movimiento</th>
                <th className="p-6">Detalle</th>
                <th className="p-6 text-center">Cant.</th>
                <th className="p-6 text-right">Monto</th>
                <th className="p-6 text-right">Cobrado</th>
                <th className="p-6 pr-8 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {activities.map(a => (
                <tr key={a.id} className={`group hover:bg-white/[0.02] transition-colors ${a.type === 'void' ? 'opacity-50 italic' : ''} ${a.is_voided ? 'opacity-40 line-through decoration-red-500/50' : ''}`}>
                  <td className="p-6">
                    <p className="text-xs font-bold text-slate-300">
                      {new Date(a.created_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </td>
                  <td className="p-6">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${
                      a.type === 'sale' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' :
                      a.type === 'fiado_payment' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                      a.type === 'restock' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      a.type === 'void' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                      a.type === 'correction' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                      'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {a.type === 'sale' ? 'Venta' : a.type === 'fiado_payment' ? 'Abono' : a.type === 'restock' ? 'Surtido' : a.type === 'void' ? 'Anulado' : a.type === 'correction' ? 'Ajuste' : a.type}
                    </span>
                  </td>
                  <td className="p-6">
                    <p className="text-sm font-black text-white uppercase tracking-tight italic">{a.product_name}</p>
                    {a.customer_name && (
                       <p className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mt-1">👤 {a.customer_name}</p>
                    )}
                    {a.notes && !a.customer_name && (
                       <p className="text-[9px] text-slate-500 font-medium mt-1 truncate max-w-[120px]">{a.notes}</p>
                    )}
                  </td>
                  <td className="p-6 text-center text-xs font-black italic">
                    <span className={a.quantity_change > 0 ? 'text-emerald-400' : 'text-slate-300'}>
                      {a.quantity_change > 0 ? '+' : ''}{a.quantity_change}
                    </span>
                  </td>
                  <td className="p-6 text-right text-sm font-black italic text-white">${a.total_amount || 0}</td>
                  <td className="p-6 text-right">
                    {a.type === 'sale' ? (
                      <div>
                        <span className={`text-sm font-black italic ${a.amount_received < a.total_amount ? 'text-amber-400' : 'text-emerald-400'}`}>
                          ${a.amount_received || 0}
                        </span>
                        {a.amount_received < a.total_amount && (
                          <div className="text-[9px] text-red-500 font-black uppercase tracking-tighter">
                            Fiado: -${(a.total_amount - (a.amount_received || 0)).toFixed(2)}
                          </div>
                        )}
                      </div>
                    ) : a.type === 'fiado_payment' ? (
                      <span className="text-emerald-400 font-black italic text-sm">${a.amount_received || 0}</span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="p-6 text-right pr-8">
                    {a.type === 'sale' && !a.is_voided && (
                      <button 
                        onClick={() => handleVoid(a)}
                        className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                      >
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {activities.length === 0 && !isLodingMore && (
                <tr><td colSpan={7} className="p-24 text-center">
                  <span className="text-4xl opacity-20 block mb-4">🔍</span>
                  <p className="text-slate-500 font-black uppercase text-[10px] tracking-[0.2em] italic">No se encontraron movimientos registrados</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {!isMobile && (
          <div className="p-8 border-t border-white/5 flex justify-between side-center bg-white/[0.01]">
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Página {page + 1}</p>
            <div className="flex gap-4">
              <button 
                onClick={handlePrevPage} 
                className="px-6 py-2 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 disabled:opacity-20 transition-all"
                disabled={page === 0}
              >
                Anterior
              </button>
              <button 
                onClick={handleNextPage} 
                className="px-6 py-2 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 disabled:opacity-20 transition-all"
                disabled={!hasMore}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {isMobile && isLodingMore && (
          <div className="p-8 text-center text-sky-500/50 animate-pulse text-[10px] font-black uppercase tracking-widest">
            Sincronizando más datos...
          </div>
        )}
      </div>
    </div>
  );
}
