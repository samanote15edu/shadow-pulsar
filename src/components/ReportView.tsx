import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { downloadCSV } from '../utils/export';

interface InventoryItem {
  id: string;
  name: string;
  current_stock: number;
  base_price: number;
}

interface Transaction {
  id: string;
  created_at: string;
  type: string;
  quantity_change: number;
  total_amount: number;
  products: { name: string };
}

export default function ReportView() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(true);
  const [otpCode, setOtpCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [otpMessage, setOtpMessage] = useState('');

  // DATE FILTER STATE
  const [rangeType, setRangeType] = useState<'today' | 'yesterday' | 'week' | 'custom'>('today');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [totalSales, setTotalSales] = useState(0);

  async function fetchReport() {
    setLoading(true);
    // 1. Validate Token and 2FA status
    const { data: tokenData, error: tokenError } = await supabase
      .from('report_tokens')
      .select('store_id, expires_at, access_level, otp_verified_at, last_activity_at')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (tokenError || !tokenData) {
      setData('invalid');
      setLoading(false);
      return;
    }

    // CHECK 2FA SESSION (20 minute timeout)
    const now = new Date();
    const lastActivity = tokenData.last_activity_at ? new Date(tokenData.last_activity_at) : null;
    const isSessionFresh = lastActivity && (now.getTime() - lastActivity.getTime()) < 20 * 60 * 1000;

    if (!tokenData.otp_verified_at || !isSessionFresh) {
      setIsLocked(true);
      setLoading(false);
      return;
    }

    setIsLocked(false);
    // Update last activity
    await supabase.from('report_tokens').update({ last_activity_at: now.toISOString() }).eq('token', token);

    // 2. Setup Date Range
    let start = new Date();
    let end = new Date();

    if (rangeType === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (rangeType === 'yesterday') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (rangeType === 'week') {
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (rangeType === 'custom' && customRange.start && customRange.end) {
      start = new Date(customRange.start);
      end = new Date(customRange.end);
      end.setHours(23, 59, 59, 999);
    }

    // 3. Fetch Data
    const { data: store } = await supabase.from('stores').select('*').eq('id', tokenData.store_id).single();
    const { data: products } = await supabase.from('products').select('*').eq('store_id', tokenData.store_id).order('current_stock', { ascending: true });

    const { data: transactions } = await supabase
      .from('transactions')
      .select('*, products(name)')
      .eq('store_id', tokenData.store_id)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });

    const sum = transactions?.filter(t => t.type === 'sale').reduce((acc, t) => acc + (Number(t.total_amount) || 0), 0) || 0;

    setData({ store, products, transactions, accessLevel: tokenData.access_level });
    setTotalSales(sum);
    setLoading(false);
  }

  useEffect(() => {
    fetchReport();
  }, [token, rangeType, customRange]);

  const handleRequestOTP = async () => {
    setIsVerifying(true);
    setOtpMessage('Enviando código...');
    const { error } = await supabase.functions.invoke('dashboard-auth', {
      body: { action: 'request-otp', token }
    });
    setIsVerifying(false);
    if (error) setOtpMessage('Error enviando el código. Reintenta.');
    else setOtpMessage('Código enviado a tu WhatsApp ✅');
  };

  const handleVerifyOTP = async () => {
    if (otpCode.length !== 6) return;
    setIsVerifying(true);
    const { data, error } = await supabase.functions.invoke('dashboard-auth', {
      body: { action: 'verify-otp', token, code: otpCode }
    });
    setIsVerifying(false);
    if (error || !data.success) {
      setOtpMessage('Código incorrecto ❌');
    } else {
      fetchReport();
    }
  };

  const handleExport = () => {
    if (!data || !data.transactions) return;
    const exportData = data.transactions.map((t: any) => ({
      Fecha: new Date(t.created_at).toLocaleString(),
      Producto: t.products?.name || 'Varios',
      Tipo: t.type === 'sale' ? 'Venta' : 'Surtido',
      Cantidad: t.quantity_change,
      Total: t.total_amount
    }));
    downloadCSV(exportData, `Reporte_${data.store.name}`);
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white font-sans uppercase font-black tracking-widest text-xs animate-pulse">Analizando Seguridad...</div>;
  if (data === 'invalid') return <div className="flex items-center justify-center min-h-screen bg-slate-900 text-red-500 font-sans font-black uppercase text-xs text-center p-8">Este acceso ha expirado.<br />Pide uno nuevo en WhatsApp.</div>;

  if (isLocked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white font-sans">
        <div className="max-w-md w-full bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 p-8 rounded-[40px] shadow-2xl text-center">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">🔐</span>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-2 italic">Acceso Protegido</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-8 leading-relaxed">
            Para ver el libro de movimientos de esta tienda, necesitamos verificar que eres el dueño.
          </p>

          {!otpMessage.includes('enviado') ? (
            <button 
              onClick={handleRequestOTP}
              disabled={isVerifying}
              className="w-full bg-emerald-500 text-black py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
            >
              {isVerifying ? 'Procesando...' : 'Pedir código a WhatsApp'}
            </button>
          ) : (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
              <input 
                type="text" 
                maxLength={6}
                placeholder="CÓDIGO DE 6 DÍGITOS"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-slate-900 border-2 border-slate-700 p-4 rounded-2xl text-center text-2xl font-black tracking-[10px] focus:border-emerald-500 outline-none transition-all"
              />
              <button 
                onClick={handleVerifyOTP}
                disabled={isVerifying || otpCode.length !== 6}
                className="w-full bg-white text-black py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-100 transition-all active:scale-95 disabled:opacity-50"
              >
                {isVerifying ? 'Verificando...' : 'Entrar al Dashboard'}
              </button>
              <button onClick={() => setOtpMessage('')} className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Reenviar código</button>
            </div>
          )}

          {otpMessage && <p className="mt-6 text-[10px] font-black uppercase tracking-widest text-emerald-400">{otpMessage}</p>}
        </div>
      </div>
    );
  }

  const isAdmin = data.accessLevel === 'admin';

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <header className="mb-0 flex flex-col md:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 leading-none uppercase tracking-tighter italic">Reporte de {data.store.name}</h1>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Sincronizado con WhatsApp Cloud API
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <a href="/" className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg">Dashboard</a>
          )}
          <button 
            onClick={handleExport}
            className="bg-sky-500 text-black px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-sky-400 transition-all shadow-lg flex items-center gap-2"
          >
            <span>↓</span> EXPORTAR CSV
          </button>
        </div>
      </header>

      {/* FILTER BAR */}
      <div className="my-8 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button onClick={() => setRangeType('today')} className={`shrink-0 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${rangeType === 'today' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'bg-transparent text-slate-400'}`}>Hoy</button>
        <button onClick={() => setRangeType('yesterday')} className={`shrink-0 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${rangeType === 'yesterday' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'bg-transparent text-slate-400'}`}>Ayer</button>
        <button onClick={() => setRangeType('week')} className={`shrink-0 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${rangeType === 'week' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'bg-transparent text-slate-400'}`}>7 Días</button>
        <button onClick={() => setRangeType('custom')} className={`shrink-0 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${rangeType === 'custom' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'bg-transparent text-slate-400'}`}>Rango</button>
      </div>

      {rangeType === 'custom' && (
        <div className="flex gap-4 mb-6 animate-in fade-in slide-in-from-top-2">
          <input type="date" className="flex-1 bg-white border border-slate-200 p-3 rounded-xl text-xs font-bold" onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} />
          <input type="date" className="flex-1 bg-white border border-slate-200 p-3 rounded-xl text-xs font-bold" onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} />
        </div>
      )}

      {/* SUMMARY CARD */}
      <section className="mb-8 grid grid-cols-2 gap-4">
        <div className="bg-slate-900 text-white p-6 rounded-3xl col-span-2 shadow-2xl overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-1">Corte del Periodo</p>
          <p className="text-4xl font-black italic tracking-tighter italic">$ {totalSales.toFixed(2)}</p>
        </div>
      </section>

      {/* STOCK ALERTS SECTION */}
      <section className="mb-8">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Alertas Críticas</h2>
        <div className="space-y-3">
          {data.products.filter((p: any) => p.current_stock < 5).slice(0, 3).map((p: InventoryItem) => (
            <div key={p.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:border-red-200 transition-colors">
              <div>
                <p className="font-bold text-slate-800 text-sm italic uppercase tracking-tight">{p.name}</p>
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Resurtir pronto</p>
              </div>
              <span className="bg-red-50 text-red-500 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                {p.current_stock}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* MOVEMENTS */}
      <section>
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Movimientos de {rangeType === 'today' ? 'Hoy' : 'Periodo'}</h2>
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          {data.transactions.length > 0 ? data.transactions.map((t: Transaction, i: number) => (
            <div key={t.id} className={`p-5 flex items-center gap-4 ${i !== data.transactions.length - 1 ? 'border-b border-slate-50' : ''} hover:bg-slate-50 transition-colors`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-md font-black ${t.type === 'sale' ? 'bg-indigo-50 text-indigo-500' : 'bg-emerald-50 text-emerald-500'}`}>
                {t.type === 'sale' ? '-' : '+'}
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-800 text-sm italic uppercase tracking-tight">{(t as any).products?.name || 'Varios'}</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                  {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(t.created_at).toLocaleDateString([], { day: '2-digit', month: 'short' })}
                </p>
              </div>
              <p className={`font-black tracking-tighter text-lg italic ${t.type === 'sale' ? 'text-slate-900' : 'text-emerald-600'}`}>
                {t.quantity_change > 0 ? `+${t.quantity_change}` : t.quantity_change}
              </p>
            </div>
          )) : (
            <div className="p-12 text-center text-slate-300 font-black uppercase text-[10px] tracking-widest italic">Sin movimientos registrados</div>
          )}
        </div>
      </section>
    </div>
  );
}
