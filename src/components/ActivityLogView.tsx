import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStoreContext } from '../context/StoreContext';
import { jsPDF } from 'jspdf';

interface Evidence {
  id: string;
  image_url: string;
}

interface ActivityLog {
  id: string;
  description: string;
  created_at: string;
  performer_id: string;
  performer_name?: string;
  evidences?: Evidence[];
}

interface Employee {
  id: string;
  full_name: string;
}

export default function ActivityLogView() {
  const { selectedStore } = useStoreContext();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [performerId, setPerformerId] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchEmployees = async () => {
    if (!selectedStore) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('store_id', selectedStore.id);
    if (data) setEmployees(data);
  };

  const fetchLogs = async () => {
    if (!selectedStore) return;
    setLoading(true);
    
    // Base Query
    let query = supabase
      .from('activity_logs')
      .select(`
        *,
        profiles (full_name)
      `)
      .eq('store_id', selectedStore.id)
      .order('created_at', { ascending: false });

    // Apply Filters
    if (searchTerm) {
      query = query.ilike('description', `%${searchTerm}%`);
    }
    if (performerId !== 'all') {
      query = query.eq('performer_id', performerId);
    }
    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59`);
    }

    const { data: logsData } = await query;

    if (logsData) {
      const logIds = logsData.map(l => l.id);
      if (logIds.length > 0) {
        const { data: evidenceData } = await supabase
          .from('activity_evidences')
          .select('*')
          .in('activity_log_id', logIds);

        const formattedLogs = logsData.map(l => ({
          ...l,
          performer_name: (l as any).profiles?.full_name || 'Desconocido',
          evidences: evidenceData?.filter(e => e.activity_log_id === l.id) || []
        }));

        setLogs(formattedLogs);
      } else {
        setLogs([]);
      }
    }
    setLoading(false);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setPerformerId('all');
    setStartDate('');
    setEndDate('');
  };

  const imgToBase64 = async (url: string): Promise<string> => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('Error loading image for PDF:', err);
      return '';
    }
  };

  const generatePDF = async () => {
    if (logs.length === 0) return;
    setExporting(true);

    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(0, 120, 215);
    doc.text(selectedStore?.name || 'Bitácora de Campo', margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(100);
    const dateRange = startDate && endDate ? `De ${startDate} a ${endDate}` : 'Reporte Consolidado';
    doc.text(`Reporte de Actividades - ${dateRange}`, margin, y);
    y += 20;

    // Content
    for (const log of logs) {
      // Check page overflow
      if (y > 250) {
        doc.addPage();
        y = 20;
      }

      // Activity Info
      doc.setFontSize(12);
      doc.setTextColor(50);
      doc.setFont('helvetica', 'bold');
      const dateStr = new Date(log.created_at).toLocaleString();
      doc.text(`[${dateStr}] - ${log.performer_name}`, margin, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(80);
      const lines = doc.splitTextToSize(`"${log.description}"`, 170);
      doc.text(lines, margin, y);
      y += (lines.length * 6) + 4;

      // Images
      if (log.evidences && log.evidences.length > 0) {
        let x = margin;
        for (const ev of log.evidences) {
          const base64 = await imgToBase64(ev.image_url);
          if (base64) {
            const imgWidth = 40;
            const imgHeight = 40;
            
            // Check if image fits horizontally, else wrap to next line
            if (x + imgWidth > 190) {
              x = margin;
              y += imgHeight + 5;
            }
            
            // Check if image fits vertically on current page
            if (y + imgHeight > 280) {
              doc.addPage();
              y = 20;
              x = margin;
            }

            doc.addImage(base64, 'JPEG', x, y, imgWidth, imgHeight);
            x += imgWidth + 5;
          }
        }
        y += 45; // Move Y after the image row
      }

      y += 10; // Extra space between items
      doc.setDrawColor(240);
      doc.line(margin, y - 5, 190, y - 5);
    }

    doc.save(`Bitacora_${selectedStore?.name || 'Reporte'}_${new Date().toISOString().split('T')[0]}.pdf`);
    setExporting(false);
  };

  useEffect(() => {
    fetchEmployees();
  }, [selectedStore]);

  useEffect(() => {
    fetchLogs();
    
    const sub = supabase.channel('activity-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs', filter: `store_id=eq.${selectedStore?.id}` }, () => fetchLogs())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_evidences' }, () => fetchLogs())
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [selectedStore, performerId, startDate, endDate]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchLogs();
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  if (loading && logs.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-8 h-8 border-2 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
      <p className="text-slate-500 text-xs font-black uppercase tracking-widest italic">Cargando Bitácoras...</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col gap-6 bg-white/[0.02] border border-white/5 rounded-3xl p-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent uppercase tracking-tighter italic">Bitácora de Campo</h2>
            <p className="text-slate-500 text-xs font-medium">Reportes de actividad y evidencias en tiempo real</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={generatePDF}
              disabled={exporting || logs.length === 0}
              className={`h-10 px-4 rounded-xl border flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${
                exporting || logs.length === 0
                ? 'bg-white/5 border-white/5 text-slate-600 cursor-not-allowed'
                : 'bg-sky-500/10 border-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-white hover:border-sky-500 shadow-lg shadow-sky-500/10'
              }`}
            >
              {exporting ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : '📄'}
              <span>Reporte PDF</span>
            </button>
            <button 
              onClick={fetchLogs}
              className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-white/20 transition-all shadow-lg"
              title="Actualizar"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-white/5">
          <div className="relative group">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-sky-400 transition-colors">🔍</span>
            <input 
              type="text" 
              placeholder="Buscar por descripción..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-sky-500/50 transition-all shadow-inner"
            />
          </div>

          <div className="flex gap-2">
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-sky-500/50 transition-all [color-scheme:dark]"
            />
            <span className="text-slate-500 self-center">→</span>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-sky-500/50 transition-all [color-scheme:dark]"
            />
          </div>

          <select 
            value={performerId}
            onChange={(e) => setPerformerId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm text-white focus:outline-none focus:border-sky-500/50 transition-all appearance-none cursor-pointer"
          >
            <option value="all">👨‍💻 Todos los empleados</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>

          <button 
            onClick={clearFilters}
            className="text-slate-500 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
          >
            Limpiar filtros
          </button>
        </div>
      </header>

      {logs.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.01] border border-dashed border-white/5 rounded-3xl">
          <p className="text-slate-500 text-sm italic uppercase tracking-widest">
            {searchTerm || startDate || endDate || performerId !== 'all' ? 'No se encontraron reportes con estos filtros' : 'No hay reportes registrados aún'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {logs.map(log => (
            <div key={log.id} className="glass-pane rounded-3xl overflow-hidden flex flex-col border border-white/5 hover:border-sky-500/30 transition-all group animate-in fade-in zoom-in duration-500">
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-sky-400 font-black uppercase tracking-widest mb-1">Actividad Reportada</span>
                    <span className="bg-sky-500/10 text-sky-400 text-[10px] px-2 py-0.5 rounded-full border border-sky-500/20 w-fit">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">{new Date(log.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <p className="text-slate-200 text-sm leading-relaxed mb-6 font-medium italic">
                  "{log.description}"
                </p>

                <div className="flex items-center gap-2 mt-auto pt-4 border-t border-white/5">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-400">
                    {log.performer_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{log.performer_name || 'Desconocido'}</span>
                </div>
              </div>

              {log.evidences && log.evidences.length > 0 && (
                <div className="p-2 pt-0 grid grid-cols-2 gap-2">
                  {log.evidences.map((ev) => (
                    <div 
                      key={ev.id} 
                      className={`relative aspect-square rounded-2xl overflow-hidden cursor-pointer group/img ${log.evidences && log.evidences.length === 1 ? 'col-span-2 aspect-video' : ''}`}
                      onClick={() => setSelectedImage(ev.image_url)}
                    >
                      <img src={ev.image_url} alt="Evidencia" className="w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                         <span className="text-white text-xl">🔍</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Image Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-300"
          onClick={() => setSelectedImage(null)}
        >
          <button className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 text-white text-2xl flex items-center justify-center hover:bg-white/20 transition-colors">×</button>
          <img src={selectedImage} alt="Fullscreen Evidence" className="max-w-full max-h-full rounded-2xl shadow-2xl shadow-black ring-1 ring-white/10 object-contain" />
        </div>
      )}
    </div>
  );
}
