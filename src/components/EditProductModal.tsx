import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: string;
    name: string;
    current_stock: number;
    base_price: number;
    last_cost_price: number;
    unit_of_measure: string;
  } | null;
  onUpdate: () => void;
}

const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product, onUpdate }) => {
  const [name, setName] = useState('');
  const [stock, setStock] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [unit, setUnit] = useState('pza');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setName(product.name);
      setStock(product.current_stock.toString());
      setPrice(product.base_price.toString());
      setCost(product.last_cost_price.toString());
      setUnit(product.unit_of_measure || 'pza');
    }
  }, [product]);

  if (!isOpen || !product) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || isSaving) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          name,
          current_stock: parseInt(stock, 10),
          base_price: parseFloat(price),
          last_cost_price: parseFloat(cost),
          unit_of_measure: unit
        })
        .eq('id', product.id);

      if (error) throw error;
      onUpdate();
      onClose();
    } catch (err) {
      alert('Error al actualizar el producto');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div 
        className="glass-pane w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-sky-400">✏️</span> Editar Producto
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Nombre del Producto</label>
            <input 
              type="text" 
              className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all font-medium"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Unidad</label>
              <select 
                className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all appearance-none"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="pza">Pieza (pza)</option>
                <option value="kg">Kilo (kg)</option>
                <option value="caja">Caja</option>
                <option value="lt">Litro (lt)</option>
                <option value="paquete">Paquete</option>
                <option value="gr">Gramo (gr)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Stock Actual</label>
              <input 
                type="number" 
                className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2">Costo ($)</label>
              <input 
                type="number" 
                step="0.01"
                className="w-full bg-slate-900/80 border border-emerald-500/20 rounded-2xl px-4 py-3 text-emerald-400 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-sky-500 uppercase tracking-widest mb-2">Venta ($)</label>
              <input 
                type="number" 
                step="0.01"
                className="w-full bg-slate-900/80 border border-sky-500/20 rounded-2xl px-4 py-3 text-sky-400 font-bold focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="pt-4">
            <button 
              type="submit"
              disabled={isSaving}
              className="w-full bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-black uppercase tracking-widest py-4 rounded-2xl shadow-lg shadow-sky-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditProductModal;
