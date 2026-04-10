import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';

interface Debtor {
  id: string;
  customer_name: string;
  current_balance: number;
  last_update_at: string | null;
}

interface Transaction {
  id: string;
  product_name: string;
  quantity_change: number;
  total_amount: number;
  created_at: string;
}

const DebtorsLedger: React.FC = () => {
  const { selectedStore, isDemo } = useStoreContext();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (selectedStore) {
      fetchDebtors();
    }
  }, [selectedStore]);

  async function fetchDebtors() {
    try {
      setLoading(true);
      if (isDemo) {
        setDebtors([
          { id: '1', customer_name: 'Tito Capu', current_balance: 150.50, last_update_at: new Date().toISOString() },
          { id: '2', customer_name: 'Alex G', current_balance: 45.00, last_update_at: null },
          { id: '3', customer_name: 'Doña Rosa', current_balance: 12.00, last_update_at: null }
        ]);
      } else {
        const { data, error } = await supabase
          .from('fiado_ledgers')
          .select('*')
          .eq('store_id', selectedStore?.id)
          .gt('current_balance', 0)
          .order('current_balance', { ascending: false });

        if (error) throw error;
        setDebtors(data || []);
      }
    } catch (err) {
      console.error('Error fetching debtors:', err);
    } finally {
      setLoading(false);
    }
  }

  const fetchHistory = async (debtor: Debtor) => {
    setSelectedDebtor(debtor);
    try {
      setLoadingHistory(true);
      if (isDemo) {
        setHistory([
          { id: 'h1', product_name: 'Galletas Chokis', quantity_change: -2, total_amount: 32.00, created_at: new Date().toISOString() },
          { id: 'h2', product_name: 'Coca Cola 600ml', quantity_change: -1, total_amount: 17.00, created_at: new Date().toISOString() }
        ]);
      } else {
        const { data, error } = await supabase
          .from('transactions')
          .select('*, products(name)')
          .eq('store_id', selectedStore?.id)
          .eq('customer_id', debtor.id)
          .eq('type', 'sale')
          .eq('is_voided', false)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Flatten the data to include product_name
        const formattedHistory = (data || []).map((tx: any) => ({
          ...tx,
          product_name: tx.products?.name || 'Producto'
        }));
        
        setHistory(formattedHistory);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handlePartialPayment = async (debtor: Debtor) => {
    const amountStr = window.prompt(`Registrar abono para ${debtor.customer_name} (Deuda: $${debtor.current_balance}):`, "");
    if (!amountStr) return;
    
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert("Por favor ingresa un monto válido mayor a 0");
      return;
    }

    if (amount > debtor.current_balance) {
      if (!window.confirm(`El abono ($${amount}) es mayor a la deuda ($${debtor.current_balance}). ¿Deseas dejar el saldo en $0?`)) return;
    }

    try {
      if (!isDemo) {
        const newBalance = Math.max(0, debtor.current_balance - amount);

        await supabase
          .from('fiado_ledgers')
          .update({ 
            current_balance: newBalance, 
            last_update_at: new Date().toISOString() 
          })
          .eq('id', debtor.id);

        await supabase.from('transactions').insert({
          store_id: selectedStore?.id,
          type: 'fiado_payment',
          total_amount: amount,
          amount_received: amount,
          customer_id: debtor.id,
          notes: `Abono registrado desde Dashboard - Cliente: ${debtor.customer_name}`
        });
      }
      fetchDebtors();
      alert(`✅ Abono de $${amount} registrado con éxito.`);
    } catch (err) {
      console.error('Error registering payment:', err);
      alert('Error al procesar el abono');
    }
  };

  const handleLiquidation = async (debtor: Debtor) => {
    if (!window.confirm(`¿Confirmas que ${debtor.customer_name} liquidó su deuda total de $${debtor.current_balance}?`)) return;

    try {
      if (!isDemo) {
        await supabase
          .from('fiado_ledgers')
          .update({ current_balance: 0, last_update_at: new Date().toISOString() })
          .eq('id', debtor.id);

        await supabase.from('transactions').insert({
          store_id: selectedStore?.id,
          type: 'fiado_payment',
          total_amount: debtor.current_balance,
          amount_received: debtor.current_balance,
          customer_id: debtor.id,
          notes: `Liquidación total de deuda: $${debtor.current_balance} - Cliente: ${debtor.customer_name}`
        });
      }
      fetchDebtors();
      alert(`✅ Deuda de ${debtor.customer_name} liquidada.`);
      setSelectedDebtor(null);
    } catch (err) {
      console.error('Error liquidating debt:', err);
      alert('Error al procesar el pago');
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-['Inter'] p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
          >
            <span>←</span> Volver al Dashboard
          </button>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
            Resumen de Deudores
          </h1>
        </div>

        {/* Stats Summary */}
        <div className="glass-pane rounded-3xl p-6 mb-8 border border-white/5 bg-white/[0.02]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-zinc-500 text-sm mb-1">Total por Cobrar</p>
              <p className="text-4xl font-bold text-amber-400">
                ${debtors.reduce((sum, d) => sum + d.current_balance, 0).toFixed(2)}
              </p>
            </div>
            <div className="flex items-center justify-end">
              <span className="text-sm text-zinc-400 bg-white/5 px-4 py-2 rounded-full">
                {debtors.length} clientes con saldo pendiente
              </span>
            </div>
          </div>
        </div>

        {/* Debtors List */}
        <div className="glass-pane rounded-3xl overflow-hidden border border-white/5 bg-white/[0.01]">
          {loading ? (
            <div className="p-12 text-center text-zinc-500">Cargando deudores...</div>
          ) : debtors.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">No hay deudas pendientes. 🙌</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-medium">Cliente</th>
                    <th className="px-6 py-4 font-medium text-center">Deuda</th>
                    <th className="px-6 py-4 font-medium text-center">Último Pago</th>
                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {debtors.map((debtor) => (
                    <tr key={debtor.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-5">
                        <p className="font-semibold text-lg">{debtor.customer_name}</p>
                        <button 
                          onClick={() => fetchHistory(debtor)}
                          className="text-[10px] text-sky-400 hover:text-sky-300 uppercase tracking-widest font-bold transition-colors flex items-center gap-1 mt-1"
                        >
                          <span className="text-sm">👁️</span> Ver detalle
                        </button>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="text-amber-400 font-bold text-lg">${debtor.current_balance.toFixed(2)}</span>
                      </td>
                      <td className="px-6 py-5 text-zinc-400 text-sm text-center">
                        {debtor.last_update_at ? new Date(debtor.last_update_at).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => handlePartialPayment(debtor)}
                            className="bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all border border-white/5"
                          >
                            Abonar
                          </button>
                          <button 
                            onClick={() => handleLiquidation(debtor)}
                            className="bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-xl text-xs font-bold transition-all transform active:scale-95"
                          >
                            Liquidar Todo
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* History Modal */}
      {selectedDebtor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm transition-all animate-in fade-in">
          <div className="bg-[#0a0a0a] w-full sm:max-w-md h-[80vh] sm:h-auto sm:max-h-[85vh] rounded-t-[2.5rem] sm:rounded-[2.5rem] border-t sm:border border-white/10 flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-8 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{selectedDebtor.customer_name}</h2>
                <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Historial de Compras (Fiado)</p>
              </div>
              <button 
                onClick={() => setSelectedDebtor(null)}
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-xl hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4">
              {loadingHistory ? (
                <div className="py-20 text-center text-zinc-500">Cargando historial...</div>
              ) : history.length === 0 ? (
                <div className="py-20 text-center text-zinc-500">No hay compras registradas para este cliente.</div>
              ) : (
                history.map((tx) => (
                  <div key={tx.id} className="bg-white/[0.03] border border-white/[0.03] rounded-2xl p-5 flex items-center justify-between group hover:border-white/10 transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-zinc-200 truncate">{tx.product_name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase font-medium mt-1">
                        {Math.abs(tx.quantity_change)} unidades • {new Date(tx.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-amber-400 font-black text-lg">${tx.total_amount.toFixed(2)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-8 border-t border-white/5 bg-white/[0.01]">
              <button 
                onClick={() => setSelectedDebtor(null)}
                className="w-full bg-white/5 hover:bg-white/10 py-4 rounded-2xl text-sm font-bold transition-all active:scale-[0.98]"
              >
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .glass-pane {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .animate-in {
          animation: modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes modalAppear {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default DebtorsLedger;
