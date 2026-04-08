import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import AddProductModal from './AddProductModal';

interface Product {
  id: string;
  name: string;
  current_stock: number;
  min_stock_alert: number;
}

interface Transaction {
  id: string;
  type: string;
  quantity_change: number;
  created_at: string;
  product_name?: string;
}

const DUMMY_PRODUCTS: Product[] = [
  { id: '1', name: 'Coca Cola 600ml', current_stock: 48, min_stock_alert: 10 },
  { id: '2', name: 'Pan Blanco', current_stock: 8, min_stock_alert: 15 },
  { id: '3', name: 'Leche Entera', current_stock: 14, min_stock_alert: 5 },
];

const DUMMY_ACTIVITIES: Transaction[] = [
  { id: '1', type: 'sale', quantity_change: -2, created_at: new Date().toISOString(), product_name: 'Refrescos' },
  { id: '2', type: 'restock', quantity_change: 20, created_at: new Date().toISOString(), product_name: 'Leche' },
];

interface DashboardProps {
  onOpenScan?: () => void;
}

export default function Dashboard({ onOpenScan }: DashboardProps) {
  const { selectedStore, stores, setSelectedStore, loading, isDemo, userName, logout } = useStoreContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentActivity, setRecentActivity] = useState<Transaction[]>([]);
  const [stats, setStats] = useState({ sales: 0, lowStock: 0, fiado: 0 });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else window.location.reload();
    setIsLoggingIn(false);
  };

  useEffect(() => {
    if (isDemo) {
      setProducts(DUMMY_PRODUCTS);
      setRecentActivity(DUMMY_ACTIVITIES);
      setStats({ sales: 1250, lowStock: 5, fiado: 840 });
      return;
    }
    if (!selectedStore) return;
    async function fetchDashboardData() {
      const { data: prods } = await supabase.from('products').select('*').eq('store_id', selectedStore?.id).order('name');
      if (prods && prods.length > 0) {
        setProducts(prods);
        setStats(prev => ({ ...prev, lowStock: prods.filter(p => p.current_stock <= p.min_stock_alert).length }));
      }
      const { data: activities } = await supabase.from('transactions').select('*, products(name)').eq('store_id', selectedStore?.id).order('created_at', { ascending: false }).limit(5);
      if (activities && activities.length > 0) {
        setRecentActivity(activities.map(a => ({ ...a, product_name: (a as any).products?.name || 'Desconocido' })));
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: sales } = await supabase.from('transactions').select('total_amount').eq('store_id', selectedStore?.id).eq('type', 'sale').gte('created_at', today.toISOString());
      const total = sales?.reduce((acc, s) => acc + (Number(s.total_amount) || 0), 0) || 0;
      if (total > 0) setStats(prev => ({ ...prev, sales: total }));
    }
    fetchDashboardData();
    const sub = supabase.channel('table-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `store_id=eq.${selectedStore.id}` }, () => fetchDashboardData()).subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [selectedStore, isDemo]);

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-4">
      <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
      <p className="animate-pulse font-medium tracking-wide">Cargando Don Chingon...</p>
    </div>
  );

  if (!selectedStore && !loading) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-4xl mb-6">🚫</div>
      <h2 className="text-xl font-bold mb-2">Tienda no encontrada</h2>
      <p className="text-slate-400 text-sm mb-8">No pudimos cargar la información de tu tienda. Es posible que el enlace haya expirado o sea incorrecto.</p>
      <button onClick={() => window.location.reload()} className="bg-sky-500 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-sky-500/20">Reintentar</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      {isDemo && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center md:text-left">
            <h2 className="text-amber-500 text-sm font-black uppercase tracking-widest">Modo Demo Activado</h2>
            <p className="text-slate-400 text-xs">Estas viendo datos de prueba.</p>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <input type="email" placeholder="Email" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Contraseña" className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" disabled={isLoggingIn} className="bg-amber-500 text-black px-6 py-2 rounded-xl text-sm font-bold hover:bg-amber-400 transition-colors uppercase">{isLoggingIn ? '...' : 'Entrar'}</button>
          </form>
        </div>
      )}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">{selectedStore?.name || 'Inventario'}</h1>
          <p className="text-slate-400 text-sm">Panel de Control</p>
        </div>
        <div className="flex items-center gap-3">
          {stores.length > 1 && (
            <select className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50" value={selectedStore?.id} onChange={(e) => setSelectedStore(stores.find(s => s.id === e.target.value)!)}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button 
            onClick={() => !isDemo && logout()} 
            className="w-10 h-10 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold hover:border-sky-400 transition-colors shadow-lg shadow-sky-500/10"
            title={userName || 'Usuario'}
          >
            {(() => {
              if (isDemo) return 'M';
              if (!userName) return 'CS';
              const parts = userName.trim().split(/\s+/);
              if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
              return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
            })()}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard title="Ventas del Día" value={`$${stats.sales}`} delta="+12%" icon="💰" color="emerald" />
          <StatCard title="Stock Bajo" value={`${stats.lowStock} Items`} delta={stats.lowStock > 0 ? "Atención" : "Optimo"} icon="⚠️" color={stats.lowStock > 0 ? "amber" : "emerald"} />
          <StatCard title="Corte Pendiente" value="Turno Tarde" delta="Abierto" icon="🕒" color="sky" />
          <StatCard title="Fiado Total" value={`$${stats.fiado}`} delta="Ledger" icon="📝" color="indigo" />
        </div>

        <div className="glass-pane rounded-3xl p-6 h-fit max-h-[500px] overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 font-black uppercase tracking-tighter italic">
            <span className="text-green-400 animate-pulse">●</span> Actividad Reciente
          </h2>
          <div className="space-y-4">
            {recentActivity.length > 0 ? recentActivity.map(a => (
              <ActivityItem key={a.id} time={new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} msg={`${a.product_name}: ${a.quantity_change > 0 ? '+' : ''}${a.quantity_change}`} user={a.type === 'restock' ? 'Reabastecimiento' : a.type === 'sale' ? 'Venta' : a.type} icon={a.type === 'restock' ? '📦' : '🥤'} />
            )) : <p className="text-slate-500 text-sm">No hay actividad reciente.</p>}
          </div>
        </div>

        <div className="lg:col-span-3 glass-pane rounded-3xl overflow-hidden mt-4">
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-white/[0.02]">
            <h2 className="text-lg font-semibold">Resumen de Stock</h2>
            <div className="flex gap-2">
              <button onClick={onOpenScan} className="bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-sky-600 transition-colors flex items-center gap-2 shadow-lg shadow-sky-500/20 uppercase tracking-widest"><span>📷</span> Escanear</button>
              <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors uppercase tracking-widest">+ Nuevo</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-500 text-xs font-black uppercase tracking-widest border-b border-slate-800">
                  <th className="p-4 pl-6">Producto</th>
                  <th className="p-4 text-center">Stock Actual</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4 text-right pr-6">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {products.length > 0 ? products.map(p => (
                  <ProductRow key={p.id} name={p.name} stock={p.current_stock} min={p.min_stock_alert} status={p.current_stock <= p.min_stock_alert ? 'Bajo' : 'Suficiente'} color={p.current_stock <= p.min_stock_alert ? 'amber' : 'emerald'} />
                )) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">No hay productos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <AddProductModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={(newProd) => {
        const prod: Product = { id: Math.random().toString(36).substr(2, 9), name: newProd.name, current_stock: newProd.stock, min_stock_alert: 5 };
        setProducts(prev => [prod, ...prev]);
      }} />
    </div>
  );
}

const StatCard: React.FC<{ title: string; value: string; delta: string; icon: string; color: string }> = ({ title, value, delta, icon, color }) => (
  <div className="glass-pane rounded-3xl p-6 transition-all hover:bg-white/[0.07] group cursor-default">
    <div className="flex justify-between items-start mb-2">
      <div className={`w-10 h-10 rounded-2xl bg-${color}-500/10 flex items-center justify-center text-xl`}>{icon}</div>
      <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full bg-${color}-500/10 text-${color}-400`}>{delta}</span>
    </div>
    <h3 className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-4">{title}</h3>
    <p className="text-3xl font-bold mt-1 text-slate-100">{value}</p>
  </div>
);

const ActivityItem: React.FC<{ time: string; msg: string; user: string; icon: string }> = ({ time, msg, user, icon }) => (
  <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.02] hover:border-sky-500/20 transition-colors">
    <div className="text-2xl">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-bold text-slate-200 truncate">{msg}</p>
      <p className="text-[10px] text-slate-500 uppercase font-medium tracking-tighter">{user} • {time}</p>
    </div>
  </div>
);

const ProductRow: React.FC<{ name: string; stock: number; min: number; status: string; color: string }> = ({ name, stock, min, status, color }) => (
  <tr className="hover:bg-white/[0.02] transition-colors group border-b border-slate-900 last:border-0">
    <td className="p-4 pl-6 text-sm font-semibold text-slate-200">{name}</td>
    <td className="p-4 text-center text-sm font-mono">{stock} <span className="text-slate-600 text-xs">/ {min}</span></td>
    <td className="p-4">
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-${color}-500/10 text-${color}-400`}>
        <span className={`w-1.5 h-1.5 rounded-full bg-${color}-400`}></span>
        {status}
      </span>
    </td>
    <td className="p-4 text-right pr-6"><button className="text-slate-600 hover:text-white transition-colors text-xs font-black italic uppercase tracking-tighter">Editar</button></td>
  </tr>
);
