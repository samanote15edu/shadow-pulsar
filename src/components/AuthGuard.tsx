import React, { useState } from 'react';
import { useStoreContext } from '../context/StoreContext';
import { supabase } from '../lib/supabase';

export const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { userRole, isVerified, setIsVerified, loading, isDemo } = useStoreContext();
  const [isVerifying, setIsVerifying] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpMessage, setOtpMessage] = useState('');

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-4">
      <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
      <p className="animate-pulse font-medium tracking-wide italic uppercase text-[10px] tracking-widest text-shadow-glow">Sincronizando Seguridad...</p>
    </div>
  );

  // Si no es dueño o es el modo Demo, o ya está verificado, dejar pasar
  if (userRole !== 'owner' || isDemo || isVerified) {
    return <>{children}</>;
  }

  // PANTALLA DE BLOQUEO GLOBAL
  const handleRequestOTP = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const params = new URLSearchParams(window.location.search);
    const u = params.get('u') || user?.id;
    if (!u) return;
    
    setIsVerifying(true);
    setOtpMessage('Enviando código...');
    const { error } = await supabase.functions.invoke('dashboard-auth', {
      body: { action: 'request-otp', token: u }
    });
    setIsVerifying(false);
    if (error) setOtpMessage('Error enviando el código. Reintenta.');
    else setOtpMessage('Código enviado a tu WhatsApp ✅');
  };

  const handleVerifyOTP = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const params = new URLSearchParams(window.location.search);
    const u = params.get('u') || user?.id;
    if (!u || otpCode.length !== 6) return;
    
    setIsVerifying(true);
    setOtpMessage(''); // Limpiar mensajes anteriores
    
    const { data, error } = await supabase.functions.invoke('dashboard-auth', {
      body: { action: 'verify-otp', token: u, code: otpCode }
    });
    
    setIsVerifying(false);
    
    if (error) {
      // Intentar extraer el mensaje de error de la respuesta JSON
      const errorMsg = await error.context?.json()?.then((j: any) => j.error).catch(() => 'Error de conexión');
      setOtpMessage(errorMsg || 'Código incorrecto ❌');
    } else if (data?.success) {
      setIsVerified(true);
      setOtpMessage('¡Acceso concedido! Entrando...');
      setTimeout(() => {
        window.location.reload(); 
      }, 1500);
    } else {
      setOtpMessage('Error de verificación');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white font-sans">
      <div className="max-w-md w-full glass-pane p-10 rounded-[40px] text-center border-white/5 shadow-2xl">
        <div className="w-24 h-24 bg-sky-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-sky-500/20 shadow-lg shadow-sky-500/10">
          <span className="text-5xl">🔐</span>
        </div>
        <h2 className="text-3xl font-black uppercase tracking-tighter mb-3 italic bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">Acceso Protegido</h2>
        <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-10 leading-relaxed opacity-70">
          Esta zona contiene información financiera sensible. Por favor, verifica tu identidad con el código enviado a tu WhatsApp.
        </p>

        {!otpMessage.includes('enviado') ? (
          <button 
            onClick={handleRequestOTP}
            disabled={isVerifying}
            className="w-full bg-sky-500 text-black py-5 rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-sky-400 transition-all active:scale-95 disabled:opacity-50 shadow-2xl shadow-sky-500/20"
          >
            {isVerifying ? 'Generando...' : 'Obtener código de acceso'}
          </button>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <input 
              type="text" 
              maxLength={6}
              placeholder="000 000"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-slate-900 border-2 border-white/10 p-5 rounded-3xl text-center text-4xl font-black tracking-[12px] focus:border-sky-500 outline-none transition-all placeholder:opacity-20 shadow-inner"
            />
            <button 
              onClick={handleVerifyOTP}
              disabled={isVerifying || otpCode.length !== 6}
              className="w-full bg-white text-black py-5 rounded-3xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-100 transition-all active:scale-95 disabled:opacity-50"
            >
              {isVerifying ? 'Autenticando...' : 'Desbloquear Panel'}
            </button>
            <button onClick={() => setOtpMessage('')} className="text-[10px] text-slate-500 font-black uppercase tracking-widest hover:text-slate-400 transition-colors">Solicitar nuevo código</button>
          </div>
        )}

        {otpMessage && <p className="mt-8 text-[10px] font-black uppercase tracking-widest text-sky-400 italic animate-pulse">{otpMessage}</p>}
      </div>
    </div>
  );
};
