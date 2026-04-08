import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Store {
  id: string;
  name: string;
  address: string;
}

interface StoreContextType {
  selectedStore: Store | null;
  stores: Store[];
  setSelectedStore: (store: Store) => void;
  loading: boolean;
  isDemo: boolean;
  logout: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const DEMO_STORE: Store = {
  id: 'demo-123',
  name: 'Abarrotes "La Esperanza" (Demo)',
  address: 'Calle Ficticia 123, MX'
};

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    async function fetchStores() {
      try {
        setLoading(true);

        // 1. Check for Magic Link (Resilient check)
        const fullUrl = window.location.href;
        const magicMatch = fullUrl.match(/[?&]s=([^&?#\s]+)/);
        const magicStoreId = magicMatch ? magicMatch[1].trim() : null;

        if (magicStoreId) {
          setIsDemo(false); 
          console.log('DEBUG: Magic ID detectado:', magicStoreId);
          const { data: magicStore, error: magicError } = await supabase
            .from('stores')
            .select('*')
            .eq('id', magicStoreId)
            .single();

          if (!magicError && magicStore) {
            console.log('DEBUG: Tienda cargada correctamente:', magicStore.name);
            setStores([magicStore]);
            setSelectedStore(magicStore);
            setLoading(false);
            return;
          } else {
            console.error('DEBUG: Error cargando tienda o no encontrada:', magicError);
          }
        }

        // 2. Fallback to standard Auth login
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          console.warn('Usando modo Demo (Sin sesión ni Magic Link)');
          setStores([DEMO_STORE]);
          setSelectedStore(DEMO_STORE);
          setIsDemo(true);
          setLoading(false);
          return;
        }

        const { data: storesList, error: storesError } = await supabase
          .from('stores')
          .select('*')
          .eq('owner_id', user.id);

        if (!storesError && storesList && storesList.length > 0) {
          setStores(storesList);
          setSelectedStore(storesList[0]);
          setIsDemo(false);
        }
      } catch (err) {
        console.error('Error en StoreContext:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStores();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <StoreContext.Provider value={{ selectedStore, stores, setSelectedStore, loading, isDemo, logout }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStoreContext = () => {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useStoreContext must be used within a StoreProvider');
  }
  return context;
};
