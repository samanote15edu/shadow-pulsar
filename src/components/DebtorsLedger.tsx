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

const DebtorsLedger: React.FC = () => {
  const { selectedStore, isDemo } = useStoreContext();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [loading, setLoading] = useState(true);
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
        // Dummy data for demo
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

  const handleLiquidation = async (debtor: Debtor) => {
    if (!window.confirm(`¿Confirmas que ${debtor.customer_name} liquidó su deuda total de $${debtor.current_balance}?`)) return;

    try {
      if (!isDemo) {
        // 1. Update ledger
        await supabase
          .from('fiado_ledgers')
          .update({ current_balance: 0, last_update_at: new Date().toISOString() })
          .eq('id', debtor.id);

        // 2. Register payment transaction
        await supabase.from('transactions').insert({
          store_id: selectedStore?.id,
          type: 'fiado_payment',
          total_amount: debtor.current_balance,
          amount_received: debtor.current_balance,
          customer_id: debtor.id,
          notes: `Liquidación total de deuda: $${debtor.current_balance}`
        });
      }
      
      // Refresh list
      fetchDebtors();
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
                    <th className="px-6 py-4 font-medium">Deuda Pendiente</th>
                    <th className="px-6 py-4 font-medium">Último Movimiento</th>
                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {debtors.map((debtor) => (
                    <tr key={debtor.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-5 font-semibold text-lg">{debtor.customer_name}</td>
                      <td className="px-6 py-5">
                        <span className="text-amber-400 font-bold text-lg">${debtor.current_balance.toFixed(2)}</span>
                      </td>
                      <td className="px-6 py-5 text-zinc-400 text-sm">
                        {debtor.last_update_at ? new Date(debtor.last_update_at).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button 
                          onClick={() => handleLiquidation(debtor)}
                          className="bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all transform active:scale-95"
                        >
                          Liquidar Todo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .glass-pane {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
      `}</style>
    </div>
  );
};

export default DebtorsLedger;
