import React, { useState } from 'react';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (product: { name: string; stock: number; price: number; cost: number; unit_of_measure: string }) => void;
}

const AddProductModal: React.FC<AddProductModalProps> = ({ isOpen, onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [stock, setStock] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [unit, setUnit] = useState('pza');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !stock || !price) return;
    onAdd({
      name,
      stock: parseInt(stock, 10),
      price: parseFloat(price),
      cost: parseFloat(cost) || 0,
      unit_of_measure: unit
    });
    // Reset and close
    setName('');
    setStock('');
    setPrice('');
    setCost('');
    setUnit('pza');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div 
        className="glass-pane w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Nuevo Producto</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Nombre del Producto</label>
            <input 
              autoFocus
              type="text" 
              className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all shadow-inner"
              placeholder="Ej: Coca Cola 600ml"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Stock Inicial</label>
              <input 
                type="number" 
                className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
                placeholder="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Unidad</label>
              <select 
                className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all appearance-none"
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-emerald-500 uppercase mb-2">Costo de Compra ($)</label>
              <input 
                type="number" 
                step="0.1"
                className="w-full bg-slate-900/50 border border-emerald-500/20 rounded-2xl px-4 py-3 text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                placeholder="0.00"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-sky-500 uppercase mb-2">Precio de Venta ($)</label>
              <input 
                type="number" 
                step="0.1"
                className="w-full bg-slate-900/50 border border-sky-500/20 rounded-2xl px-4 py-3 text-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all font-bold"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4">
            <button 
              type="submit"
              className="w-full bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-sky-500/20 transition-all active:scale-[0.98]"
            >
              Guardar Producto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddProductModal;
