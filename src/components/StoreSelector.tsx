import React from 'react';
import { useStoreContext } from '../context/StoreContext';
import { Building2, MapPin, ChevronRight, LogOut, Plus } from 'lucide-react';

const StoreSelector: React.FC = () => {
  const { stores, setSelectedStore, logout, userName } = useStoreContext();

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-4xl z-10">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tighter italic uppercase mb-2">
              Tus Tiendas
            </h1>
            <p className="text-slate-500 font-medium lowercase tracking-tight">
              bienvenido de nuevo, <span className="text-sky-400 font-bold">{userName || 'dueño'}</span>. selecciona una sucursal para gestionar.
            </p>
          </div>
          <button 
            onClick={logout}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-all text-xs font-bold uppercase tracking-widest"
          >
            <LogOut size={14} />
            Salir
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stores.map((store) => (
            <button
              key={store.id}
              onClick={() => setSelectedStore(store)}
              className="group relative bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-sky-500/50 rounded-3xl p-6 text-left transition-all duration-300 hover:translate-y-[-4px] hover:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.5)]"
            >
              <div className="flex flex-col h-full">
                <div className="mb-6 flex justify-between items-start">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-white/10 flex items-center justify-center overflow-hidden group-hover:scale-110 transition-transform duration-500">
                    {store.logo_url ? (
                      <img src={store.logo_url} alt={store.name} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="text-sky-400" size={32} />
                    )}
                  </div>
                  <div className="px-3 py-1 bg-sky-500/10 border border-sky-500/20 rounded-full">
                    <span className="text-[10px] font-black text-sky-400 uppercase tracking-widest italic">Sucursal</span>
                  </div>
                </div>

                <div className="flex-grow">
                  <h3 className="text-xl font-black text-white group-hover:text-sky-400 transition-colors tracking-tight uppercase mb-2">
                    {store.name}
                  </h3>
                  <div className="flex items-start gap-2 text-slate-500 group-hover:text-slate-400 transition-colors">
                    <MapPin size={14} className="mt-0.5 shrink-0" />
                    <span className="text-xs font-medium leading-relaxed italic">{store.address || 'Sin dirección registrada'}</span>
                  </div>
                </div>

                <div className="mt-8 flex items-center justify-between">
                  <span className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em]">Entrar al Panel</span>
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-sky-500 group-hover:text-white transition-all duration-300">
                    <ChevronRight size={18} />
                  </div>
                </div>
              </div>
            </button>
          ))}

          {/* New Store Placeholder */}
          <button className="group relative bg-dashed border-2 border-white/5 hover:border-white/10 rounded-3xl p-6 text-center flex flex-col items-center justify-center gap-4 transition-all opacity-40 hover:opacity-100 min-h-[240px]">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Plus className="text-slate-500" />
            </div>
            <span className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] italic">Nueva Sucursal</span>
          </button>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 flex justify-center">
            <p className="text-[10px] text-slate-700 font-black uppercase tracking-[0.3em] italic">
              Don Chingón <span className="mx-2 opacity-30">•</span> Retail Engine v4.0
            </p>
        </div>
      </div>
    </div>
  );
};

export default StoreSelector;
