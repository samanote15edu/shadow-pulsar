import React, { useEffect, useState } from 'react';
// Build trigger: Confirming partial voiding logic deployment
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import AddProductModal from './AddProductModal';
import EditProductModal from './EditProductModal';

interface Product {
  id: string;
  name: string;
  current_stock: number;
  min_stock_alert: number;
  base_price: number;
  last_cost_price: number;
  unit_of_measure: string;
}

interface Transaction {
  id: string;
  type: string;
  quantity_change: number;
  created_at: string;
  product_name?: string;
  unit_price?: number;
  total_amount: number;
  amount_received: number;
  product_id?: string;
  is_voided?: boolean;
  voided_quantity?: number;
  customer_name?: string;
}

const DUMMY_PRODUCTS: Product[] = [
  { id: '1', name: 'Coca Cola 600ml', current_stock: 48, min_stock_alert: 10, base_price: 20, last_cost_price: 12, unit_of_measure: 'pza' },
  { id: '2', name: 'Pan Blanco', current_stock: 8, min_stock_alert: 15, base_price: 35, last_cost_price: 28, unit_of_measure: 'pza' },
  { id: '3', name: 'Leche Entera', current_stock: 14, min_stock_alert: 5, base_price: 25, last_cost_price: 18, unit_of_measure: 'pza' },
];

const DUMMY_ACTIVITIES: Transaction[] = [
  { id: '1', type: 'sale', quantity_change: -2, created_at: new Date().toISOString(), product_name: 'Refrescos', total_amount: 30, amount_received: 30 },
  { id: '2', type: 'restock', quantity_change: 20, created_at: new Date().toISOString(), product_name: 'Leche', total_amount: 0, amount_received: 0 },
];

interface DashboardProps {
  onOpenScan?: () => void;
}

export default function Dashboard({ onOpenScan }: DashboardProps) {
  const { selectedStore, stores, setSelectedStore, loading, isDemo, userName, logout } = useStoreContext();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentActivity, setRecentActivity] = useState<Transaction[]>([]);
  const [stats, setStats] = useState({ sales: 0, lowStock: 0, fiado: 0, shrinkage: 0 });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
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

  const fetchDashboardData = async () => {
    if (isDemo || !selectedStore) return;
    const { data: prods } = await supabase.from('products').select('*').eq('store_id', selectedStore?.id).order('name');
    if (prods && prods.length > 0) {
      setProducts(prods.map(p => ({ ...p, unit_of_measure: p.unit_of_measure || 'pza' })));
      setStats(prev => ({ ...prev, lowStock: prods.filter(p => p.current_stock <= p.min_stock_alert).length }));
    }
    const { data: activities } = await supabase.from('transactions').select('*, products(name), fiado_ledgers(customer_name)').eq('store_id', selectedStore?.id).order('created_at', { ascending: false }).limit(5);
    if (activities && activities.length > 0) {
      setRecentActivity(activities.map(a => ({ 
        ...a, 
        product_name: (a as any).products?.name || 'Desconocido',
        customer_name: (a as any).fiado_ledgers?.customer_name || (a as any).fiado_ledgers?.[0]?.customer_name || null
      })));
    }
    // Fix Sales del día calculation to use local day start
    const now = new Date();
    const localToday = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const todayStart = new Date(localToday + 'T00:00:00').toISOString();
    
    const { data: transactions } = await supabase
      .from('transactions')
      .select('total_amount, type')
      .eq('store_id', selectedStore?.id)
      .in('type', ['sale', 'void'])
      .gte('created_at', todayStart);

    const netSales = transactions?.reduce((acc, t) => {
      if (t.type === 'sale') return acc + (Number(t.total_amount) || 0);
      if (t.type === 'void') return acc - (Number(t.total_amount) || 0);
      return acc;
    }, 0) || 0;
    
    // Calculate Shrinkage (Corrections) in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const { data: corrections } = await supabase
      .from('transactions')
      .select('quantity_change, product_id, products(base_price)')
      .eq('store_id', selectedStore?.id)
      .eq('type', 'correction')
      .gte('created_at', thirtyDaysAgo.toISOString());
    
    const totalShrinkage = corrections?.reduce((acc, c) => {
      const price = (c as any).products?.base_price || 0;
      return acc + (c.quantity_change * price);
    }, 0) || 0;

    setStats(prev => ({ ...prev, sales: netSales, shrinkage: totalShrinkage }));
  };

  useEffect(() => {
    if (isDemo) {
      setProducts(DUMMY_PRODUCTS);
      setRecentActivity(DUMMY_ACTIVITIES);
      setStats({ sales: 1250, lowStock: 5, fiado: 840, shrinkage: -150 });
      return;
    }
    if (!selectedStore) return;
    fetchDashboardData();
    const sub = supabase.channel('table-db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `store_id=eq.${selectedStore.id}` }, () => fetchDashboardData()).subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [selectedStore, isDemo]);

  const handleEditClick = (product: Product) => {
    setProductToEdit(product);
    setIsEditModalOpen(true);
  };

  const handleVoid = async (transaction: Transaction) => {
    if (!transaction.product_id || transaction.type !== 'sale' || transaction.is_voided) return;
    
    // 1. Reason
    const reason = window.prompt(`¿Motivo de la anulación para ${transaction.product_name}?\n(${Math.abs(transaction.quantity_change)} unidades)`);
    if (reason === null) return; 

    // 2. Quantity (Partial logic)
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

      // 1. Update original transaction
      const { error: markError } = await supabase.from('transactions')
        .update({ 
          voided_quantity: newVoidedQty,
          is_voided: isFullVoid 
        })
        .eq('id', transaction.id);
      if (markError) throw markError;

      // 2. Revert stock
      const { error: stockError } = await supabase.rpc('increment_stock', {
        row_id: transaction.product_id,
        amount: qtyToVoid
      });
      if (stockError) throw stockError;

      // 3. Create NEW reversal record
      const unitPrice = transaction.unit_price || 0;
      const { error: voidError } = await supabase.from('transactions').insert({ 
        store_id: selectedStore?.id,
        product_id: transaction.product_id,
        type: 'void',
        quantity_change: qtyToVoid,
        total_amount: qtyToVoid * unitPrice,
        notes: `Reversa (${qtyToVoid}/${Math.abs(transaction.quantity_change)}) de: ${transaction.id}. Motivo: ${reason || 'Sin motivo'}`
      });
      if (voidError) throw voidError;

      fetchDashboardData();
    } catch (err) {
      console.error('Error voiding transaction:', err);
      alert('No se pudo anular la venta.');
    }
  };

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
          <StatCard title="Mermas (30d)" value={`$${Math.abs(stats.shrinkage)}`} delta={stats.shrinkage < 0 ? "Pérdida" : "Ajuste"} icon="📉" color={stats.shrinkage < 0 ? "red" : "sky"} />
          <StatCard title="Stock Bajo" value={`${stats.lowStock} Items`} delta={stats.lowStock > 0 ? "Atención" : "Optimo"} icon="⚠️" color={stats.lowStock > 0 ? "amber" : "emerald"} />
          <StatCard title="Fiado Total" value={`$${stats.fiado}`} delta="Ledger" icon="📝" color="indigo" />
        </div>

        <div className="glass-pane rounded-3xl p-6 h-fit max-h-[500px] overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4 flex items-center justify-between font-black uppercase tracking-tighter italic">
            <span className="flex items-center gap-2"><span className="text-green-400 animate-pulse">●</span> Actividad Reciente</span>
            <button 
              onClick={() => navigate('/ledger')}
              className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors tracking-widest"
            >
              Ver Todo →
            </button>
          </h2>
          <div className="space-y-4">
            {recentActivity.length > 0 ? recentActivity.map(a => (
              <ActivityItem 
                key={a.id} 
                transaction={a}
                onVoid={() => handleVoid(a)}
              />
            )) : <p className="text-slate-500 text-sm">No hay actividad reciente.</p>}
          </div>
        </div>

        <div className="lg:col-span-3 glass-pane rounded-3xl overflow-hidden mt-4">
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-white/[0.02]">
            <h2 className="text-lg font-semibold">Inventario de Productos</h2>
            <div className="flex gap-2">
              <button onClick={onOpenScan} className="bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-sky-600 transition-colors flex items-center gap-2 shadow-lg shadow-sky-500/20 uppercase tracking-widest"><span>📷</span> Escanear</button>
              <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors uppercase tracking-widest">+ Nuevo</button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left hidden md:table">
              <thead>
                <tr className="text-slate-500 text-xs font-black uppercase tracking-widest border-b border-slate-800">
                  <th className="p-4 pl-6">Producto</th>
                  <th className="p-4 text-center">Stock</th>
                  <th className="p-4 text-center">Costo</th>
                  <th className="p-4 text-center">Venta</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4 text-right pr-6">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {products.length > 0 ? products.map(p => (
                  <ProductRow key={p.id} product={p} onEdit={() => handleEditClick(p)} />
                )) : <tr><td colSpan={6} className="p-8 text-center text-slate-500">No hay productos registrados.</td></tr>}
              </tbody>
            </table>

            <div className="md:hidden divide-y divide-slate-800/50">
              {products.length > 0 ? products.map(p => (
                <ProductCard key={p.id} product={p} onEdit={() => handleEditClick(p)} />
              )) : <div className="p-8 text-center text-slate-500">No hay productos registrados.</div>}
            </div>
          </div>
        </div>
      </main>

      <AddProductModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={(newProd) => {
        const prod: Product = { 
          id: Math.random().toString(36).substr(2, 9), 
          name: newProd.name, 
          current_stock: newProd.stock, 
          min_stock_alert: 5, 
          base_price: newProd.price, 
          last_cost_price: 0,
          unit_of_measure: newProd.unit_of_measure || 'pza'
        };
        setProducts(prev => [prod, ...prev]);
        fetchDashboardData();
      }} />

      <EditProductModal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        product={productToEdit} 
        onUpdate={() => fetchDashboardData()} 
      />
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

const ActivityItem: React.FC<{ transaction: Transaction, onVoid: () => void }> = ({ transaction, onVoid }) => {
  const time = new Date(transaction.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msg = `${transaction.product_name}: ${transaction.quantity_change > 0 ? '+' : ''}${transaction.quantity_change}`;
  const user = transaction.type === 'restock' ? 'Surtido' : transaction.type === 'sale' ? 'Venta' : transaction.type === 'void' ? 'ANULACION' : transaction.type;
  const icon = transaction.type === 'restock' ? '📦' : transaction.type === 'void' ? '🚫' : '🥤';
  const isPartial = transaction.type === 'sale' && transaction.amount_received < (transaction.total_amount || 0);

  return (
    <div className={`flex items-center gap-4 p-4 rounded-2xl border transition-colors ${transaction.type === 'void' ? 'bg-red-500/5 border-red-500/10 italic' : 'bg-white/[0.03] border-white/[0.02]'} ${transaction.is_voided ? 'opacity-40 line-through decoration-red-500/50' : 'hover:border-sky-500/20'}`}>
      <div className="text-2xl">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-200 truncate">{msg}</p>
          {isPartial && (
            <span className="text-[8px] font-black bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30">FIADO</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[10px] text-slate-500 uppercase font-medium tracking-tighter">{user} • {time}</p>
          {transaction.customer_name && (
            <span className="text-[10px] text-indigo-400 font-bold">👤 {transaction.customer_name}</span>
          )}
        </div>
      </div>
      {transaction.type === 'sale' && !transaction.is_voided && (
        <button 
          onClick={(e) => { e.stopPropagation(); onVoid(); }}
          className="text-[9px] font-black uppercase bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all px-3 py-1.5 rounded-lg active:scale-95"
          title="Anular venta"
        >
          Anular
        </button>
      )}
    </div>
  );
};

const ProductRow: React.FC<{ product: Product, onEdit: () => void }> = ({ product, onEdit }) => {
  const isLow = product.current_stock <= product.min_stock_alert;
  const color = isLow ? 'amber' : 'emerald';
  const status = isLow ? 'Bajo' : 'Suficiente';

  return (
    <tr className="hover:bg-white/[0.02] transition-colors group border-b border-slate-900 last:border-0">
      <td className="p-4 pl-6 text-sm font-semibold text-slate-200">{product.name}</td>
      <td className="p-4 text-center">
        <div className="flex flex-col items-center">
          <span className="text-sm font-mono text-white font-bold">{product.current_stock}</span>
          <span className="text-[10px] text-slate-500 uppercase font-black bg-white/5 px-1 rounded-sm">{product.unit_of_measure}</span>
        </div>
      </td>
      <td className="p-4 text-center text-sm font-mono text-slate-400">${product.last_cost_price}</td>
      <td className="p-4 text-center text-sm font-mono text-sky-400 font-bold">${product.base_price}</td>
      <td className="p-4">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-${color}-500/10 text-${color}-400`}>
          <span className={`w-1.5 h-1.5 rounded-full bg-${color}-400`}></span>
          {status}
        </span>
      </td>
      <td className="p-4 text-right pr-6">
        <button 
          onClick={onEdit}
          className="text-slate-600 hover:text-white transition-colors text-xs font-black italic uppercase tracking-tighter"
        >
          Editar
        </button>
      </td>
    </tr>
  );
};

const ProductCard: React.FC<{ product: Product, onEdit: () => void }> = ({ product, onEdit }) => {
  const isLow = product.current_stock <= product.min_stock_alert;
  const color = isLow ? 'amber' : 'emerald';
  const status = isLow ? 'Bajo' : 'Suficiente';

  return (
    <div className="p-4 hover:bg-white/[0.02] transition-colors active:bg-white/[0.05]" onClick={onEdit}>
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-bold text-slate-100">{product.name}</h3>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-${color}-500/10 text-${color}-400`}>
          <span className={`w-1.5 h-1.5 rounded-full bg-${color}-400`}></span>
          {status}
        </span>
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/[0.03]">
          <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">Stock</p>
          <div className="flex items-center gap-1">
            <p className="text-sm font-mono font-bold text-slate-100">{product.current_stock}</p>
            <span className="text-[8px] text-slate-500 uppercase font-black bg-white/5 px-1 rounded-sm">{product.unit_of_measure}</span>
          </div>
        </div>
        <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/[0.03]">
          <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">Costo</p>
          <p className="text-sm font-mono font-bold text-slate-400">${product.last_cost_price}</p>
        </div>
        <div className="bg-sky-500/5 p-3 rounded-2xl border border-sky-500/10">
          <p className="text-sky-500/50 text-[9px] font-black uppercase tracking-widest mb-1">Venta</p>
          <p className="text-sm font-mono font-bold text-sky-400">${product.base_price}</p>
        </div>
      </div>
      <div className="mt-3 text-right">
        <span className="text-[9px] text-slate-600 font-black uppercase tracking-tighter italic">Toca para editar</span>
      </div>
    </div>
  );
};
