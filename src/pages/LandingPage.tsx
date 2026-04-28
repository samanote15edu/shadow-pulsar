import React from 'react';
import { Check, MessageCircle, BarChart3, Zap, ShieldCheck } from 'lucide-react';

const LandingPage: React.FC = () => {
  const plans = [
    {
      name: 'Básico',
      price: '120',
      description: 'Ideal para emprendedores individuales y pequeños puestos.',
      features: [
        'Bot de WhatsApp 24/7',
        'Gestión de Inventario básica',
        'Hasta 50 productos',
        'Reporte de ventas diario',
        'Soporte por email'
      ],
      cta: 'Comenzar ahora',
      highlighted: false
    },
    {
      name: 'Gerencial',
      price: '300',
      description: 'Perfecto para negocios en crecimiento con múltiples empleados.',
      features: [
        'Todo lo del plan Básico',
        'Hasta 3 sucursales/tiendas',
        'Gestión de Fiados avanzada',
        'Dashboard web completo',
        'Analítica de inventario'
      ],
      cta: 'Probar Gerencial',
      highlighted: true
    },
    {
      name: 'Pro',
      price: '850',
      description: 'La solución definitiva para tiendas de alto volumen.',
      features: [
        'Todo lo del plan Gerencial',
        'Tiendas ilimitadas',
        'Soporte para Escáner Físico (POS)',
        'Analítica predictiva de stock',
        'Soporte prioritario 1-a-1'
      ],
      cta: 'Ir a Pro',
      highlighted: false
    }
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-white overflow-x-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 glass-pane py-4 px-8 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center animate-float">
            <Zap className="text-white fill-white" size={24} />
          </div>
          <span className="text-2xl font-bold tracking-tight">Shadow <span className="text-gradient">Pulsar</span></span>
        </div>
        <div className="hidden md:flex gap-8 text-sm font-medium">
          <a href="#features" className="hover:text-indigo-400 transition-colors">Funciones</a>
          <a href="#pricing" className="hover:text-indigo-400 transition-colors">Precios</a>
          <a href="#contact" className="hover:text-indigo-400 transition-colors">Contacto</a>
        </div>
        <button className="btn-premium text-sm py-2 px-6">Acceder</button>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-8 max-w-7xl mx-auto text-center relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-indigo-500/10 blur-[120px] rounded-full -z-10"></div>
        <h1 className="text-5xl md:text-7xl font-extrabold leading-tight mb-6">
          Controla tu Inventario <br />
          <span className="text-gradient">con solo un Mensaje</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          Transforma tu WhatsApp en un potente sistema de gestión. Sin apps complicadas, sin curvas de aprendizaje. Solo tú, tu bot y tu negocio.
        </p>
        <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
          <button className="btn-premium text-lg px-10 py-4">Empieza Gratis Hoy</button>
          <button className="px-10 py-4 rounded-full border border-gray-700 hover:bg-white/5 transition-all flex items-center gap-2">
            Ver Demo <Zap size={18} />
          </button>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="glass-card p-8 hover:translate-y-[-5px] transition-all">
            <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center mb-6 text-indigo-400">
              <MessageCircle size={28} />
            </div>
            <h3 className="text-xl font-bold mb-4">Interfaz WhatsApp</h3>
            <p className="text-gray-400">Vende, resurte y consulta stock directamente desde WhatsApp. Tan fácil como chatear con un amigo.</p>
          </div>
          <div className="glass-card p-8 hover:translate-y-[-5px] transition-all">
            <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mb-6 text-purple-400">
              <BarChart3 size={28} />
            </div>
            <h3 className="text-xl font-bold mb-4">Reportes en Vivo</h3>
            <p className="text-gray-400">Visualiza tus ventas y ganancias en tiempo real desde nuestro dashboard web optimizado.</p>
          </div>
          <div className="glass-card p-8 hover:translate-y-[-5px] transition-all">
            <div className="w-12 h-12 bg-cyan-500/20 rounded-lg flex items-center justify-center mb-6 text-cyan-400">
              <ShieldCheck size={28} />
            </div>
            <h3 className="text-xl font-bold mb-4">Gestión de Fiados</h3>
            <p className="text-gray-400">Lleva el control de quién te debe y cuánto. El bot te ayuda a recordar y cobrar de forma profesional.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-8 max-w-7xl mx-auto text-center">
        <h2 className="text-4xl font-bold mb-4">Planes diseñados para crecer</h2>
        <p className="text-gray-400 mb-16">Escoge el plan que mejor se adapte a tu nivel actual de ventas.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan) => (
            <div 
              key={plan.name} 
              className={`glass-card p-10 flex flex-col relative transition-all duration-300 ${
                plan.highlighted ? 'ring-2 ring-indigo-500 scale-105 bg-indigo-500/5' : 'hover:bg-white/5'
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-500 text-xs font-bold px-4 py-1 rounded-full uppercase tracking-widest">
                  Más Popular
                </span>
              )}
              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <div className="mb-6">
                <span className="text-4xl font-extrabold">${plan.price}</span>
                <span className="text-gray-500"> /mes</span>
              </div>
              <p className="text-gray-400 text-sm mb-8">{plan.description}</p>
              
              <div className="flex-grow">
                <ul className="text-left space-y-4 mb-10">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                      <div className="min-w-[20px] h-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                        <Check size={12} strokeWidth={3} />
                      </div>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <button className={`w-full py-4 rounded-xl font-bold transition-all ${
                plan.highlighted 
                  ? 'btn-premium' 
                  : 'bg-white/10 hover:bg-white/20'
              }`}>
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-gray-800 text-center">
        <p className="text-gray-500 text-sm">
          © 2026 Shadow Pulsar. Todos los derechos reservados. <br />
          Hecho con ❤️ para los dueños de negocios en México.
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
