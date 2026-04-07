import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { BarcodeScanner } from './BarcodeScanner';

/**
 * A mobile-first scanner designed for one-hand operation in a store.
 */

export default function FastScan() {
  const { token } = useParams<{ token: string }>();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [productData, setProductData] = useState<any | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [result, setResult] = useState<string>('Esperando escaneo...');

  useEffect(() => {
    async function validateToken() {
      const { data } = await supabase.from('report_tokens').select('store_id').eq('token', token).gt('expires_at', new Date().toISOString()).single();
      if (data) setStoreId(data.store_id);
    }
    validateToken();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const scanner = new Html5QrcodeScanner(
      'reader',
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128],
      },
      false
    );

    scanner.render((result) => {
      setScannedResult(result);
      lookupProduct(result);
      scanner.clear();
    }, () => { /* ignore normal scanning errors */ });

    return () => { scanner.clear(); };
  }, [token]);

  const lookupProduct = async (barcode: string) => {
    if (!storeId) return;
    const { data } = await supabase.from('products').select('*').eq('store_id', storeId).eq('barcode', barcode).single();

    if (data) {
      setProductData(data);
      setResult(`Producto: ${data.name}`);
    } else {
      setResult('Producto no encontrado');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-md mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-center">Escaneo Rápido</h1>

        <div id="reader" className="overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900/50"></div>

        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <p className="text-sm font-medium text-zinc-400 mb-1">Resultado:</p>
          <p className="text-lg font-bold">{result}</p>
        </div>

        {productData && (
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
            <p className="text-xl font-bold">{productData.name}</p>
            <p className="text-3xl font-black text-white">${productData.price}</p>
            <p className="text-sm text-zinc-400">Stock: {productData.stock}</p>
          </div>
        )}

        <button
          onClick={() => window.location.reload()}
          className="w-full py-4 rounded-xl bg-white text-black font-extrabold text-lg hover:bg-zinc-200 transition-colors"
        >
          SIGUIENTE ESCANEO
        </button>
      </div>
    </div>
  );
}
