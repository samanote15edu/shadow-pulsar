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
  const [stores, setStores] = useState<Store[]>([DEMO_STORE]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(DEMO_STORE);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    async function fetchStores() {
      try {
        // 1. Get current authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          console.warn('Usando modo Demo (No hay sesión de Supabase)');
          setLoading(false);
          return;
        }

        // 2. Fetch stores where user is the owner
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
