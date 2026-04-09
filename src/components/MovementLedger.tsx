import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';

interface Transaction {
  id: string;
  type: string;
  quantity_change: number;
  created_at: string;
  product_name: string;
  unit_price: number;
  total_amount: number;
  notes?: string;
  product_id: string;
}

export default function MovementLedger() {
  const { selectedStore, loading, isDemo } = useStoreContext();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<Transaction[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLodingMore, setIsLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const scrollRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 20;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchMovements = async (pageToFetch: number, append = false) => {
    if (!selectedStore || isDemo) return;
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
      query = query.gte('created_at', new Date(dateRange.start).toISOString());
    }
    if (dateRange.end) {
      const end = new Date(dateRange.end);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }

    const { data, error } = await query;

    if (data) {
      const mapped = data.map(a => ({
        ...a,
        product_name: (a as any).products?.name || 'Desconocido'
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
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isMobile, hasMore, isLodingMore, page]);

  const handleVoid = async (transaction: Transaction) => {
    const reason = window.prompt(`¿Motivo de la anulación para ${transaction.product_name}?`);
    if (reason === null) return; // Cancelled

    try {
      // 1. Revert stock
      await supabase.rpc('increment_stock', {
        row_id: transaction.product_id,
        amount: Math.abs(transaction.quantity_change)
      });

      // 2. Mark as void with reason
      await supabase.from('transactions').update({ 
        type: 'void',
        notes: reason || 'Sin motivo especificado'
      }).eq('id', transaction.id);

      fetchMovements(page, false);
    } catch (err) {
      alert('Error al anular');
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <button onClick={() => navigate('/')} className="text-sky-400 text-xs font-black uppercase tracking-widest mb-2 flex items-center gap-2">
            ← Volver al Panel
          </button>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">Libro de Movimientos</h1>
          <p className="text-slate-400 text-sm">Historial y Auditoría de Stock</p>
        </div>

        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <input 
            type="date" 
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs"
            value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
          />
          <input 
            type="date" 
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs"
            value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
          />
          <select 
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">Todos los Tipos</option>
            <option value="sale">Ventas</option>
            <option value="restock">Surtidos</option>
            <option value="void">Anulaciones</option>
            <option value="correction">Ajustes</option>
          </select>
        </div>
      </header>

      <div className="glass-pane rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-800 bg-white/[0.02]">
                <th className="p-4 pl-6">Fecha</th>
                <th className="p-4">Tipo</th>
                <th className="p-4">Producto</th>
                <th className="p-4 text-center">Cant.</th>
                <th className="p-4 text-right">Monto</th>
                <th className="p-4">Notas</th>
                <th className="p-4 text-right pr-6">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {activities.map(a => (
                <tr key={a.id} className={`hover:bg-white/[0.02] transition-colors ${a.type === 'void' ? 'opacity-50 italic' : ''}`}>
                  <td className="p-4 pl-6 text-xs text-slate-400">
                    {new Date(a.created_at).toLocaleDateString()}<br/>
                    <span className="text-[10px] opacity-50">{new Date(a.created_at).toLocaleTimeString()}</span>
                  </td>
                  <td className="p-4">
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${
                      a.type === 'sale' ? 'bg-sky-500/10 text-sky-400' :
                      a.type === 'restock' ? 'bg-emerald-500/10 text-emerald-400' :
                      a.type === 'void' ? 'bg-red-500/10 text-red-500' :
                      'bg-slate-500/10 text-slate-400'
                    }`}>
                      {a.type === 'sale' ? 'Venta' : a.type === 'restock' ? 'Surtido' : a.type === 'void' ? 'Anulado' : a.type}
                    </span>
                  </td>
                  <td className="p-4 text-xs font-bold text-slate-200">{a.product_name}</td>
                  <td className="p-4 text-center text-xs font-mono">{a.quantity_change > 0 ? '+' : ''}{a.quantity_change}</td>
                  <td className="p-4 text-right text-xs font-mono">${a.total_amount || 0}</td>
                  <td className="p-4 text-[10px] text-slate-500 max-w-[150px] truncate" title={a.notes}>{a.notes || '-'}</td>
                  <td className="p-4 text-right pr-6">
                    {a.type === 'sale' && (
                      <button 
                        onClick={() => handleVoid(a)}
                        className="text-[9px] font-black uppercase text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {activities.length === 0 && !isLodingMore && (
                <tr><td colSpan={7} className="p-12 text-center text-slate-500 text-sm">No se encontraron movimientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación para Desktop */}
        {!isMobile && (
          <div className="p-6 border-t border-slate-800 flex justify-between items-center bg-white/[0.01]">
            <p className="text-xs text-slate-500 font-bold uppercase tracking-tighter">Página {page + 1}</p>
            <div className="flex gap-2">
              <button 
                onClick={handlePrevPage} 
                className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold disabled:opacity-30"
                disabled={page === 0}
              >
                Anterior
              </button>
              <button 
                onClick={handleNextPage} 
                className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold disabled:opacity-30"
                disabled={!hasMore}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* Indicador de carga para móvil */}
        {isMobile && isLodingMore && (
          <div className="p-8 text-center text-sky-500/50 animate-pulse text-xs font-black uppercase">
            Cargando más...
          </div>
        )}
      </div>
    </div>
  );
}
