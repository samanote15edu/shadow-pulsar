/** 
 * TIENDITA FRESH: FAST BARCODE SCANNER
 * A mobile-first scanner designed for one-hand operation in a store.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { supabase } from '../lib/supabase';

export default function FastScan() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [foundProduct, setFoundProduct] = useState<any>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function validateToken() {
      const { data } = await supabase.from('report_tokens').select('store_id').eq('token', token).gt('expires_at', new Date().toISOString()).single();
      if (data) setStoreId(data.store_id);
    }
    validateToken();

    const scanner = new Html5QrcodeScanner("reader", {
      fps: 10,
      qrbox: 250,
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.UPC_A]
    }, false);

    scanner.render((result) => {
      setScannedResult(result);
      lookupProduct(result);
      scanner.clear();
    }, (err) => { /* ignore normal scanning errors */ });

    return () => { scanner.clear(); };
  }, [token]);

  const lookupProduct = async (barcode: string) => {
    if (!storeId) return;
    const { data } = await supabase.from('products').select('*').eq('store_id', storeId).eq('barcode', barcode).single();
    if (data) setFoundProduct(data);
    else setIsRegistering(true);
  };

  const handleAction = async (type: 'sale' | 'restock') => {
    if (!foundProduct || !storeId) return;
    setLoading(true);
    const change = type === 'sale' ? -1 : 1;

    await supabase.from('inventory_batches').insert({ product_id: foundProduct.id, quantity_original: 1, quantity_remaining: 1, unit_cost: 0 }); // Simplified for scanner
    await supabase.from('products').update({ current_stock: foundProduct.current_stock + change }).eq('id', foundProduct.id);
    await supabase.from('transactions').insert({ store_id: storeId, product_id: foundProduct.id, type, quantity_change: change, total_amount: type === 'sale' ? foundProduct.base_price : 0 });

    alert(`✅ ${type === 'sale' ? 'Venta' : 'Surtido'} de ${foundProduct.name} Guardada.`);
    window.location.reload(); // Reset for next scan
  };

  const handleRegister = async () => {
    if (!newName || !newPrice || !storeId) return;
    setLoading(true);
    const { data } = await supabase.from('products').insert({
      store_id: storeId,
      name: newName,
      base_price: parseFloat(newPrice),
      current_stock: 0,
      barcode: scannedResult
    }).select().single();

    setFoundProduct(data);
    setIsRegistering(false);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent italic uppercase tracking-tighter">Escáner Tiendita</h1>
      </header>

      <div id="reader" className="w-full rounded-3xl overflow-hidden border-2 border-dashed border-slate-800 bg-slate-900 aspect-square mb-6"></div>

      {scannedResult && (
        <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 mb-6">
            <p className="text-xs text-slate-500 uppercase font-black mb-1">Código Detectado</p>
            <p className="text-2xl font-mono tracking-widest">{scannedResult}</p>
          </div>

          {foundProduct ? (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <p className="text-3xl font-black text-white">{foundProduct.name}</p>
                <p className="text-slate-400 font-bold">$ {foundProduct.base_price.toFixed(2)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => handleAction('sale')} disabled={loading} className="bg-sky-500 text-black py-6 rounded-3xl font-black uppercase text-lg shadow-lg shadow-sky-500/20 active:scale-95 transition-all">Venta (-1)</button>
                <button onClick={() => handleAction('restock')} disabled={loading} className="bg-emerald-500 text-black py-6 rounded-3xl font-black uppercase text-lg shadow-lg shadow-emerald-500/20 active:scale-95 transition-all">Surtir (+1)</button>
              </div>
            </div>
          ) : isRegistering ? (
            <div className="bg-amber-500/10 p-6 rounded-3xl border border-amber-500/20 space-y-4">
              <p className="text-amber-500 font-black uppercase text-xs">Producto Nuevo</p>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre (Ej: Coca 600ml)" className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
              <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Precio Venta ($)" className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
              <button onClick={handleRegister} disabled={loading} className="w-full bg-amber-500 text-black py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-amber-400 transition-colors">Guardar Producto</button>
            </div>
          ) : null}
        </div>
      )}

      {!scannedResult && (
        <div className="text-center text-slate-500 mt-12 flex-1">
          <p className="text-xs font-black uppercase tracking-widest animate-pulse">Buscando Código...</p>
        </div>
      )}
    </div>
  );
}
