import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Falling back to Demo Mode placeholders.');
}

console.log('DEBUG: Supabase Config - URL:', supabaseUrl ? 'Detectada' : 'MISSING', 'Key:', supabaseAnonKey ? 'Detectada' : 'MISSING');

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder'
);
