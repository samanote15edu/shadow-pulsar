import React, { useEffect, useState } from 'react';
// Build trigger: Confirming partial voiding logic deployment
import StoreSelector from './StoreSelector';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import AddProductModal from './AddProductModal';
import EditProductModal from './EditProductModal';
import ApprovalInbox from './ApprovalInbox';
import ActivityLogView from './ActivityLogView';

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
  const { selectedStore, stores, setSelectedStore, loading, isDemo, userName, userRole, logout } = useStoreContext();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentActivity, setRecentActivity] = useState<Transaction[]>([]);
  const [stats, setStats] = useState({ sales: 0, lowStock: 0, fiado: 0, shrinkage: 0 });
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
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
    const { data: prods } = await supabase.from('products').select('*').eq('store_id', selectedStore?.id).eq('is_active', true).order('name');
    if (prods && prods.length > 0) {
      setProducts(prods.map(p => ({ ...p, unit_of_measure: p.unit_of_measure || 'pza' })));
      const low = prods.filter(p => p.current_stock <= p.min_stock_alert);
      setStats(prev => ({ ...prev, lowStock: low.length }));
      setLowStockProducts(low);
    }
    const { data: activities } = await supabase.from('transactions')
      .select('*, products(name), fiado_ledgers(customer_name)')
      .eq('store_id', selectedStore?.id)
      .eq('is_voided', false)
      .neq('type', 'void')
      .order('created_at', { ascending: false })
      .limit(5);
    if (activities) {
      setRecentActivity(activities.map(a => ({ 
        ...a, 
        product_name: (a as any).products?.name || (a.type === 'fiado_payment' ? 'Abono de Deuda' : 'Desconocido'),
        customer_name: (a as any).fiado_ledgers?.customer_name || a.customer_name || null
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

    // Calculate Total Fiado (Debt)
    const { data: fiadoData } = await supabase
      .from('fiado_ledgers')
      .select('current_balance')
      .eq('store_id', selectedStore?.id);
    
    const totalFiado = fiadoData?.reduce((acc, f) => acc + (Number(f.current_balance) || 0), 0) || 0;

    setStats(prev => ({ ...prev, sales: netSales, shrinkage: totalShrinkage, fiado: totalFiado }));
  };

  useEffect(() => {
    if (isDemo) {
      setProducts(DUMMY_PRODUCTS);
      setRecentActivity(DUMMY_ACTIVITIES);
      setStats({ sales: 1250, lowStock: 1, fiado: 840, shrinkage: -150 });
      setLowStockProducts([DUMMY_PRODUCTS[1]]); // Pan Blanco is low
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

  const handleDeleteProduct = async (product: Product) => {
    if (!selectedStore) return;
    const confirmed = window.confirm(`¿Estas seguro(a) que quieres eliminar este producto?`);
    if (!confirmed) return;

    try {
      // 1. Soft delete product
      const { error: deleteError } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', product.id);

      if (deleteError) throw deleteError;

      // 2. Record deletion in Ledger for traceability
      const { error: logError } = await supabase.from('transactions').insert({
        store_id: selectedStore.id,
        product_id: product.id,
        type: 'correction',
        quantity_change: 0,
        notes: `PRODUCTO ELIMINADO: ${product.name}`
      });
      if (logError) console.error('Error recording deletion in ledger:', logError);

      setProducts(prev => prev.filter(p => p.id !== product.id));
      fetchDashboardData();
    } catch (err) {
      console.error('Error deleting product:', err);
      alert('Hubo un error al intentar eliminar el producto.');
    }
  };

  if (!selectedStore && !loading) {
    if (isDemo) return <StoreSelector />; // Demo can also see selector for testing
    if (stores.length > 0) return <StoreSelector />;
    
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-4xl mb-6">🚫</div>
        <h2 className="text-xl font-bold mb-2 uppercase tracking-tighter italic">Sin Acceso</h2>
        <p className="text-slate-400 text-sm mb-8 max-w-xs">No tienes tiendas asignadas o tu sesión ha expirado.</p>
        <button onClick={logout} className="bg-sky-500 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-sky-500/20 uppercase tracking-widest text-xs">Regresar al Inicio</button>
      </div>
    );
  }

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
            <button 
              onClick={() => (setSelectedStore as any)(null)}
              className="px-4 py-2 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 hover:border-sky-500 rounded-xl text-sky-400 transition-all text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2"
            >
              <span>🏢</span> Mis Negocios
            </button>
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
      
      {selectedStore?.business_type === 'activity_logs' ? (
        <ActivityLogView />
      ) : (
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard title="Ventas del Día" value={`$${stats.sales}`} delta="+12%" icon="💰" color="emerald" />
            {userRole === 'owner' && (
              <StatCard 
                title="Mermas (30d)" 
                value={`$${Math.abs(stats.shrinkage)}`} 
                delta={stats.shrinkage < 0 ? "Pérdida" : "Ver Detalle"} 
                icon="📉" 
                color={stats.shrinkage < 0 ? "red" : "sky"} 
                onClick={() => navigate('/audit')}
              />
            )}
            <StatCard 
              title="Stock Bajo" 
              value={`${stats.lowStock} Items`} 
              delta={stats.lowStock > 0 ? "Atención" : "Optimo"} 
              icon="⚠️" 
              color={stats.lowStock > 0 ? "amber" : "emerald"}
              description={lowStockProducts.length > 0 ? lowStockProducts.map(p => p.name).join(', ') : undefined}
            />
            <StatCard 
              title="Fiado Total" 
              value={`$${stats.fiado}`} 
              delta="Ver Detalles" 
              icon="👥" 
              color="indigo" 
              onClick={() => navigate('/debtors')}
            />
          </div>

          <div className="space-y-6">
            {userRole === 'owner' && (
              <div className="glass-pane rounded-3xl p-6">
                <h2 className="text-lg font-black mb-4 uppercase tracking-tighter italic flex items-center gap-2">
                  <span className="text-sky-400">⚡</span> Bandeja de Aprobación
                </h2>
                <ApprovalInbox />
              </div>
            )}

            <div className="glass-pane rounded-3xl p-6 h-fit max-h-[500px] overflow-y-auto">
              <h2 className="text-lg font-semibold mb-4 flex items-center justify-between font-black uppercase tracking-tighter italic">
                <span className="flex items-center gap-2"><span className="text-green-400 animate-pulse">●</span> Actividad Reciente</span>
                {userRole === 'owner' && (
                  <button 
                    onClick={() => navigate('/ledger')}
                    className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors tracking-widest"
                  >
                    Ver Todo →
                  </button>
                )}
              </h2>
              <div className="space-y-4">
                {recentActivity.length > 0 ? recentActivity.map(a => (
                  <ActivityItem 
                    key={a.id} 
                    transaction={a}
                    onVoid={() => handleVoid(a)}
                    showVoid={userRole === 'owner'}
                  />
                )) : <p className="text-slate-500 text-sm">No hay actividad reciente.</p>}
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 glass-pane rounded-3xl overflow-hidden mt-4">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-white/[0.02]">
              <h2 className="text-lg font-semibold">Inventario de Productos</h2>
              <div className="flex gap-2">
                <button onClick={onOpenScan} className="bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-sky-600 transition-colors flex items-center gap-2 shadow-lg shadow-sky-500/20 uppercase tracking-widest"><span>📷</span> Escanear</button>
                {userRole === 'owner' && (
                  <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors uppercase tracking-widest">+ Nuevo</button>
                )}
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left hidden md:table">
                <thead>
                  <tr className="text-slate-500 text-xs font-black uppercase tracking-widest border-b border-slate-800">
                    <th className="p-4 pl-6">Producto</th>
                    <th className="p-4 text-center">Stock</th>
                    {userRole === 'owner' && <th className="p-4 text-center">Costo</th>}
                    <th className="p-4 text-center">Venta</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4 text-right pr-6">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                    {products.length > 0 ? products.map(p => (
                      <ProductRow 
                        key={p.id} 
                        product={p} 
                        onEdit={() => handleEditClick(p)} 
                        onDelete={() => handleDeleteProduct(p)}
                        userRole={userRole}
                      />
                    )) : <tr><td colSpan={userRole === 'owner' ? 6 : 5} className="p-8 text-center text-slate-500">No hay productos registrados.</td></tr>}
                </tbody>
              </table>

              <div className="md:hidden divide-y divide-slate-800/50">
                  {products.length > 0 ? products.map(p => (
                    <ProductCard 
                      key={p.id} 
                      product={p} 
                      onEdit={() => handleEditClick(p)} 
                      onDelete={() => handleDeleteProduct(p)}
                      userRole={userRole}
                    />
                  )) : <div className="p-8 text-center text-slate-500">No hay productos registrados.</div>}
              </div>
            </div>
          </div>
        </main>
      )}

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

const StatCard: React.FC<{ title: string; value: string; delta: string; icon: string; color: string; onClick?: () => void; description?: string }> = ({ title, value, delta, icon, color, onClick, description }) => (
  <div 
    onClick={onClick}
    className={`glass-pane rounded-3xl p-6 transition-all group ${onClick ? 'cursor-pointer hover:bg-white/[0.07] hover:border-white/20 hover:scale-[1.02] border border-transparent' : 'cursor-default flex flex-col justify-between'}`}
  >
    <div>
      <div className="flex justify-between items-start mb-2">
        <div className={`w-10 h-10 rounded-2xl bg-${color}-500/10 flex items-center justify-center text-xl`}>{icon}</div>
        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full bg-${color}-500/10 text-${color}-400`}>{delta}</span>
      </div>
      <h3 className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-4">{title}</h3>
      <p className="text-3xl font-bold mt-1 text-slate-100">{value}</p>
    </div>
    {description && (
      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-[10px] text-amber-500/70 font-black uppercase tracking-tighter italic truncate" title={description}>
          {description}
        </p>
      </div>
    )}
  </div>
);

const ActivityItem: React.FC<{ transaction: Transaction, onVoid: () => void, showVoid: boolean }> = ({ transaction, onVoid, showVoid }) => {
  const time = new Date(transaction.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isPayment = transaction.type === 'fiado_payment';
  const msg = isPayment 
    ? `Abono recibido: $${transaction.total_amount?.toFixed(2)}`
    : `${transaction.product_name}: ${transaction.quantity_change > 0 ? '+' : ''}${transaction.quantity_change}`;
    
  const user = isPayment ? 'PAGO RECIBIDO' : transaction.type === 'restock' ? 'Surtido' : transaction.type === 'sale' ? 'Venta' : transaction.type === 'void' ? 'ANULACION' : transaction.type;
  const icon = isPayment ? '💰' : transaction.type === 'restock' ? '📦' : transaction.type === 'void' ? '🚫' : '🥤';
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
      {transaction.type === 'sale' && !transaction.is_voided && showVoid && (
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

const ProductRow: React.FC<{ product: Product, onEdit: () => void, onDelete: () => void, userRole: string | null }> = ({ product, onEdit, onDelete, userRole }) => {
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
      {userRole === 'owner' && <td className="p-4 text-center text-sm font-mono text-slate-400">${product.last_cost_price}</td>}
      <td className="p-4 text-center text-sm font-mono text-sky-400 font-bold">${product.base_price}</td>
      <td className="p-4">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-${color}-500/10 text-${color}-400`}>
          <span className={`w-1.5 h-1.5 rounded-full bg-${color}-400`}></span>
          {status}
        </span>
      </td>
      <td className="p-4 text-right pr-6">
        <div className="flex justify-end gap-3 items-center">
          {userRole === 'owner' && (
            <>
              <button 
                onClick={onEdit}
                className="text-slate-600 hover:text-white transition-colors text-xs font-black italic uppercase tracking-tighter"
              >
                Editar
              </button>
              <button 
                onClick={onDelete}
                className="text-red-900/40 hover:text-red-500 transition-colors text-xs font-black italic uppercase tracking-tighter"
                title="Eliminar producto"
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
};

const ProductCard: React.FC<{ product: Product, onEdit: () => void, onDelete: () => void, userRole: string | null }> = ({ product, onEdit, onDelete, userRole }) => {
  const isLow = product.current_stock <= product.min_stock_alert;
  const color = isLow ? 'amber' : 'emerald';
  const status = isLow ? 'Bajo' : 'Suficiente';

  return (
    <div 
      className="p-4 hover:bg-white/[0.02] transition-colors active:bg-white/[0.05]" 
      onClick={() => userRole === 'owner' && onEdit()}
    >
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
        <div className="bg-sky-500/5 p-3 rounded-2xl border border-sky-500/10 col-span-2 sm:col-span-1">
          <p className="text-sky-500/50 text-[9px] font-black uppercase tracking-widest mb-1">Venta</p>
          <p className="text-sm font-mono font-bold text-sky-400">${product.base_price}</p>
        </div>
        {userRole === 'owner' && (
          <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/[0.03]">
            <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">Costo</p>
            <p className="text-sm font-mono font-bold text-slate-400">${product.last_cost_price}</p>
          </div>
        )}
      </div>
      {userRole === 'owner' && (
        <div className="mt-4 flex justify-between items-center pt-3 border-t border-white/[0.03]">
          <span className="text-[9px] text-slate-700 font-black uppercase tracking-tighter italic">ID: {product.id.slice(0,8)}</span>
          <div className="flex gap-4">
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="text-[10px] text-sky-400 font-black uppercase tracking-widest"
            >
              Editar
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="text-[10px] text-red-500/50 hover:text-red-500 font-black uppercase tracking-widest"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
