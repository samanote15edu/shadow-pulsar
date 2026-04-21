import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { ShoppingBag, Package, ArrowLeft, Plus, Minus, Trash2, Check, Eye, EyeOff, AlertCircle } from 'lucide-react';

type ScanMode = 'sale' | 'inventory';

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  barcode: string;
}

export default function FastScan() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  // Detectar modo inicial por URL (?m=inventory)
  const queryParams = new URLSearchParams(window.location.search);
  const initialMode = (queryParams.get('m') === 'inventory' ? 'inventory' : 'sale') as ScanMode;

  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastScanned, setLastScanned] = useState<any | null>(null);
  const [isCosterVisible, setIsCosterVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // Audio Context for Beep
  const playBeep = (type: 'success' | 'error' = 'success') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'success' ? 880 : 220, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
      
      if (navigator.vibrate) {
        navigator.vibrate(type === 'success' ? 50 : [100, 50, 100]);
      }
    } catch (e) {
      console.warn('Audio disabled by browser policy');
    }
  };

  useEffect(() => {
    async function validateToken() {
      if (!token) return;
      const { data, error } = await supabase
        .from('report_tokens')
        .select('store_id')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .single();
      
      if (error || !data) {
        setError('Token inválido o expirado. Solicita uno nuevo en WhatsApp.');
      } else {
        setStoreId(data.store_id);
      }
    }
    validateToken();
  }, [token]);

  useEffect(() => {
    if (!token || !storeId) return;

    if (!scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        'reader',
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13, 
            Html5QrcodeSupportedFormats.EAN_8, 
            Html5QrcodeSupportedFormats.CODE_128
          ],
        },
        /* verbose= */ false
      );

      scannerRef.current.render((resultString) => {
        handleScan(resultString);
      }, () => {});
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
        scannerRef.current = null;
      }
    };
  }, [token, storeId]);

  const handleScan = async (barcode: string) => {
    if (!storeId || isProcessing) return;
    
    setIsProcessing(true);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeId)
      .eq('barcode', barcode)
      .maybeSingle();

    if (error) {
       playBeep('error');
       setIsProcessing(false);
       return;
    }

    if (data) {
      playBeep('success');
      if (mode === 'sale') {
        addToCart(data, barcode);
      } else {
        setLastScanned(data);
        setIsCosterVisible(false);
      }
    } else {
      playBeep('error');
      setLastScanned({ barcode, isNew: true });
    }
    
    // Resume scanning after a short delay
    setTimeout(() => setIsProcessing(false), 2000);
  };

  const addToCart = (product: any, barcode: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { 
        id: product.id, 
        name: product.name, 
        price: product.base_price, 
        qty: 1,
        barcode 
      }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.qty + delta);
        return { ...item, qty: newQty };
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const [showSuccess, setShowSuccess] = useState<{ type: 'sale' | 'restock', total?: number, name?: string } | null>(null);

  const processCheckout = async (type: 'cash' | 'fiado', customerId?: string) => {
    if (isProcessing || cart.length === 0) return;
    setIsProcessing(true);
    
    try {
      const currentTotal = total;
      // 1. Registrar cada item en stock y transacciones
      const promises = cart.map(async (item) => {
        await supabase.rpc('increment_stock', { row_id: item.id, amount: -item.qty });
        return supabase.from('transactions').insert({
          store_id: storeId,
          product_id: item.id,
          type: 'sale',
          quantity_change: -item.qty,
          unit_price: item.price,
          total_amount: item.price * item.qty,
          amount_received: type === 'cash' ? (item.price * item.qty) : 0,
          customer_id: customerId || null,
          notes: `Venta vía Escáner${type === 'fiado' ? ' (Fiado)' : ''}`
        });
      });

      await Promise.all(promises);

      if (type === 'fiado' && customerId) {
        const { data: ledger } = await supabase.from('fiado_ledgers').select('current_balance').eq('id', customerId).single();
        if (ledger) {
          await supabase.from('fiado_ledgers')
            .update({ 
              current_balance: Number(ledger.current_balance) + currentTotal,
              last_update_at: new Date().toISOString()
            })
            .eq('id', customerId);
        }
      }

      playBeep('success');
      setCart([]);
      setLastScanned(null);
      setShowSuccess({ type: 'sale', total: currentTotal });
    } catch (err) {
      console.error(err);
      playBeep('error');
      alert('❌ Error al procesar la venta');
    } finally {
      setIsProcessing(false);
    }
  };

  const [restockQty, setRestockQty] = useState<string>('');

  const processRestock = async () => {
    if (!lastScanned || !restockQty || isProcessing) return;
    const qty = parseInt(restockQty);
    if (isNaN(qty) || qty <= 0) return;

    setIsProcessing(true);
    try {
      await supabase.rpc('increment_stock', { row_id: lastScanned.id, amount: qty });
      await supabase.from('transactions').insert({
        store_id: storeId,
        product_id: lastScanned.id,
        type: 'restock',
        quantity_change: qty,
        unit_price: lastScanned.last_cost_price || 0,
        total_amount: (lastScanned.last_cost_price || 0) * qty,
        notes: 'Surtido vía Escáner'
      });

      playBeep('success');
      setShowSuccess({ type: 'restock', name: lastScanned.name });
      setRestockQty('');
      setLastScanned(null);
    } catch (err) {
      console.error(err);
      playBeep('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const [showFiadoModal, setShowFiadoModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const searchCustomers = async (val: string) => {
    setCustomerSearch(val);
    if (val.length < 2) {
      setSearchResults([]);
      return;
    }
    const { data } = await supabase.from('fiado_ledgers').select('*').eq('store_id', storeId).ilike('customer_name', `%${val}%`);
    setSearchResults(data || []);
  };

  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', cost: '' });

  const registerNewProduct = async () => {
    if (!lastScanned || !newProduct.name || !newProduct.price || isProcessing) return;
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.from('products').insert({
        store_id: storeId,
        barcode: lastScanned.barcode,
        name: newProduct.name,
        base_price: parseFloat(newProduct.price),
        last_cost_price: parseFloat(newProduct.cost) || 0,
        current_stock: 0
      }).select().single();

      if (error) throw error;
      
      playBeep('success');
      alert(`✅ Producto creado: ${newProduct.name}`);
      setLastScanned(data);
      setShowNewProductModal(false);
      setNewProduct({ name: '', price: '', cost: '' });
    } catch (err) {
      console.error(err);
      playBeep('error');
      alert('❌ Error al crear producto');
    } finally {
      setIsProcessing(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
        <div className="bg-zinc-900 border border-red-500/50 p-8 rounded-3xl max-w-sm space-y-4">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold text-white">Error de Acceso</h1>
          <p className="text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header Fijo */}
      <header className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between sticky top-0 z-50">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-zinc-900 rounded-full transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex bg-zinc-900 p-1 rounded-full">
          <button 
            onClick={() => setMode('sale')}
            className={`px-4 py-1.5 rounded-full flex items-center gap-2 text-sm font-bold transition-all ${mode === 'sale' ? 'bg-white text-black' : 'text-zinc-400'}`}
          >
            <ShoppingBag className="w-4 h-4" /> Venta
          </button>
          <button 
            onClick={() => setMode('inventory')}
            className={`px-4 py-1.5 rounded-full flex items-center gap-2 text-sm font-bold transition-all ${mode === 'inventory' ? 'bg-white text-black' : 'text-zinc-400'}`}
          >
            <Package className="w-4 h-4" /> Surtido
          </button>
        </div>
        <div className="w-10"></div>
      </header>

      <main className="flex-1 overflow-y-auto pb-40">
        <div className="p-4 space-y-6">
          {/* Cámara Section */}
          <div className="relative group">
            <div id="reader" className="overflow-hidden rounded-3xl border-2 border-zinc-800 bg-zinc-900 overflow-hidden shadow-2xl">
              {/* Overlay de procesamiento */}
              {isProcessing && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
                  <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            <div className="absolute inset-0 pointer-events-none border-[40px] border-black/20 rounded-3xl"></div>
          </div>

          {/* Área de Trabajo dinámico */}
          {mode === 'sale' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-zinc-400" />
                  Carrito ({cart.length})
                </h2>
                {cart.length > 0 && (
                  <button onClick={() => setCart([])} className="text-sm text-red-400 font-bold">Limpiar</button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 border-2 border-dashed border-zinc-800 rounded-3xl">
                  <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Escanea un producto para empezar</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cart.map(item => (
                    <div key={item.id} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center gap-4">
                      <div className="flex-1">
                        <p className="font-bold line-clamp-1">{item.name}</p>
                        <p className="text-zinc-400 text-sm">${item.price} c/u</p>
                      </div>
                      <div className="flex items-center bg-black rounded-xl p-1 gap-3">
                        <button onClick={() => updateQty(item.id, -1)} className="p-1 hover:text-red-400"><Minus className="w-5 h-5" /></button>
                        <span className="font-black text-lg min-w-[20px] text-center">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="p-1 hover:text-green-400"><Plus className="w-5 h-5" /></button>
                      </div>
                      <button onClick={() => removeItem(item.id)} className="p-2 text-zinc-600 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
               <h2 className="text-xl font-bold flex items-center gap-2 px-2">
                  <Package className="w-5 h-5 text-zinc-400" />
                  Último Escaneado
                </h2>
                
                {lastScanned ? (
                  <div className="p-6 bg-zinc-900 border-2 border-zinc-700 rounded-3xl space-y-6">
                    {lastScanned.isNew ? (
                      <div className="text-center space-y-4 py-4">
                        <AlertCircle className="w-16 h-16 text-yellow-500 mx-auto" />
                        <div>
                          <p className="text-xl font-bold">Producto Nuevo</p>
                          <p className="text-zinc-400 text-sm">Código: {lastScanned.barcode}</p>
                        </div>
                        <button 
                          onClick={() => setShowNewProductModal(true)}
                          className="w-full py-4 bg-yellow-500 text-black font-black rounded-2xl active:scale-95 transition-all"
                        >
                          REGISTRAR AHORA
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="text-2xl font-black">{lastScanned.name}</p>
                          <p className="text-zinc-400">Stock actual: {lastScanned.current_stock}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-zinc-950 rounded-2xl">
                            <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Precio Venta</p>
                            <p className="text-2xl font-black">${lastScanned.base_price}</p>
                          </div>
                          <div className="p-4 bg-zinc-950 rounded-2xl relative">
                            <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Costo Anterior</p>
                            <div className="flex items-center justify-between">
                              <p className="text-2xl font-black">
                                {isCosterVisible ? `$${lastScanned.last_cost_price || 0}` : '••••'}
                              </p>
                              <button 
                                onClick={() => setIsCosterVisible(!isCosterVisible)}
                                className="p-1 text-zinc-600"
                              >
                                {isCosterVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <label className="block text-sm font-bold text-zinc-400">¿Cuántos llegaron?</label>
                          <input 
                            type="number" 
                            placeholder="Cantidad..."
                            value={restockQty}
                            onChange={(e) => setRestockQty(e.target.value)}
                            className="w-full bg-black border border-zinc-800 p-4 rounded-2xl text-2xl font-bold focus:border-white outline-none transition-all"
                          />
                          <button 
                            onClick={processRestock}
                            disabled={!restockQty || isProcessing}
                            className="w-full py-4 bg-white text-black font-black text-lg rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Check className="w-6 h-6" /> {isProcessing ? 'Procesando...' : 'REGISTRAR ENTRADA'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="py-12 text-center text-zinc-500 border-2 border-dashed border-zinc-800 rounded-3xl">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>Escanea un producto para surtirlo</p>
                  </div>
                )}
            </div>
          )}
        </div>
      </main>

      {/* Footer Acciones de Cierre */}
      {mode === 'sale' && cart.length > 0 && (
        <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black to-transparent">
          <div className="max-w-md mx-auto p-6 bg-white text-black rounded-3xl shadow-2xl space-y-4">
            <div className="flex justify-between items-end">
              <span className="text-sm font-bold uppercase opacity-60">Total a pagar</span>
              <span className="text-4xl font-black leading-none">${total.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setShowFiadoModal(true)}
                disabled={isProcessing}
                className="py-4 bg-zinc-200 rounded-2xl font-black hover:bg-zinc-300 transition-all disabled:opacity-50"
              >
                FIADO
              </button>
              <button 
                onClick={() => processCheckout('cash')}
                disabled={isProcessing}
                className="py-4 bg-black text-white rounded-2xl font-black shadow-lg shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
              >
                {isProcessing ? '...' : 'PAGO EFECTIVO'}
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Modal de Búsqueda de Deudores (Fiado) */}
      {showFiadoModal && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm p-4 flex flex-col items-center justify-center">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="text-xl font-bold">¿A quién le fiamos?</h3>
              <button onClick={() => setShowFiadoModal(false)} className="text-zinc-500 font-bold">Cerrar</button>
            </div>
            
            <div className="p-4">
              <div className="relative">
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Escribe nombre del cliente..."
                  className="w-full bg-black border border-zinc-700 p-4 rounded-2xl outline-none focus:border-white transition-all"
                  value={customerSearch}
                  onChange={(e) => searchCustomers(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {searchResults.length > 0 ? (
                searchResults.map(c => (
                  <button 
                    key={c.id}
                    onClick={() => {
                       setShowFiadoModal(false);
                       processCheckout('fiado', c.id);
                    }}
                    className="w-full p-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-left border border-zinc-700/50 flex justify-between items-center group transition-all"
                  >
                    <span className="font-bold">{c.customer_name}</span>
                    <Check className="w-5 h-5 opacity-0 group-hover:opacity-100 text-green-400 transition-opacity" />
                  </button>
                ))
              ) : (
                <div className="py-12 text-center text-zinc-600">
                   {customerSearch.length >= 2 ? 'No se encontraron clientes' : 'Empieza a escribir para buscar'}
                </div>
              )}
            </div>
            
            <div className="p-4 bg-zinc-950/50 border-t border-zinc-800">
               <button 
                 onClick={async () => {
                   if (!customerSearch.trim()) return;
                   const { data: newC } = await supabase.from('fiado_ledgers').insert({ store_id: storeId, customer_name: customerSearch, current_balance: 0 }).select().single();
                   if (newC) {
                      setShowFiadoModal(false);
                      processCheckout('fiado', newC.id);
                   }
                 }}
                 className="w-full py-4 bg-zinc-800 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-zinc-700 transition-colors"
               >
                 <Plus className="w-5 h-5" /> Crear deudor "{customerSearch || '...'}"
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Registro de Producto Nuevo */}
      {showNewProductModal && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md p-4 flex flex-col items-center justify-center">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col p-6 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold">Nuevo Producto</h3>
              <button onClick={() => setShowNewProductModal(false)} className="text-zinc-500 font-bold">Cancelar</button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-500 font-bold uppercase ml-1">Nombre</label>
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Ej. Coca Cola 600ml"
                  className="w-full bg-black border border-zinc-700 p-4 rounded-2xl outline-none focus:border-white transition-all text-xl"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-500 font-bold uppercase ml-1">Precio Venta</label>
                  <input 
                    type="number" 
                    placeholder="25"
                    className="w-full bg-black border border-zinc-700 p-4 rounded-2xl outline-none focus:border-white transition-all text-xl"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({...newProduct, price: e.target.value})}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 font-bold uppercase ml-1">Costo (Opc)</label>
                  <input 
                    type="number" 
                    placeholder="18"
                    className="w-full bg-black border border-zinc-700 p-4 rounded-2xl outline-none focus:border-white transition-all text-xl font-bold text-zinc-400"
                    value={newProduct.cost}
                    onChange={(e) => setNewProduct({...newProduct, cost: e.target.value})}
                  />
                </div>
              </div>
            </div>

            <button 
              onClick={registerNewProduct}
              disabled={!newProduct.name || !newProduct.price || isProcessing}
              className="w-full py-5 bg-white text-black font-black text-xl rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:scale-[1.02]"
            >
              <Check className="w-6 h-6" /> {isProcessing ? 'CREANDO...' : 'GUARDAR PRODUCTO'}
            </button>
          </div>
        </div>
      )}

      {/* Pantalla de Éxito (Overlay) */}
      {showSuccess && (
        <div className="fixed inset-0 z-[200] bg-black p-6 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300">
           <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(34,197,94,0.4)]">
              <Check className="w-12 h-12 text-black stroke-[4px]" />
           </div>
           
           <h2 className="text-4xl font-black mb-2">¡Completado!</h2>
           <p className="text-zinc-400 text-lg mb-12">
             {showSuccess.type === 'sale' 
               ? `Venta registrada por $${showSuccess.total?.toFixed(2)}` 
               : `Surtido registrado: ${showSuccess.name}`}
           </p>

           <button 
             onClick={() => setShowSuccess(null)}
             className="w-full max-w-xs py-5 bg-white text-black font-black text-xl rounded-2xl shadow-xl active:scale-95 transition-all"
           >
             CONTINUAR
           </button>
        </div>
      )}
    </div>
  );
}
