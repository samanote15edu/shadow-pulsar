import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Store {
  id: string;
  name: string;
  address: string;
  logo_url?: string;
  description?: string;
  business_type?: 'inventory' | 'activity_logs';
}

interface StoreContextType {
  selectedStore: Store | null;
  stores: Store[];
  setSelectedStore: (store: Store) => void;
  loading: boolean;
  isDemo: boolean;
  userName: string | null;
  userRole: 'owner' | 'employee' | null;
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
  const [userName, setUserName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'employee' | null>(null);

  useEffect(() => {
    async function fetchStores() {
      try {
        setLoading(true);
        const params = new URLSearchParams(window.location.search);
        
        // --- 1. MAGIC LINK ENTRY (u and/or s parameters) ---
        const urlStoreId = params.get('s')?.trim() || null;
        const magicUserId = params.get('u')?.trim() || null;
        
        // Force Global View if 'u' is present but NO 's' is in the URL
        const isForceGlobal = params.has('u') && !params.has('s');
        
        // Final store ID to try loading (checking cache only if NOT forcing global)
        let targetStoreId: string | null = urlStoreId;
        if (!targetStoreId && !isForceGlobal) {
          targetStoreId = localStorage.getItem('last_store_id');
        }

        // A. Loading from Profile ID (u=...) - HUB ACCESS
        if (magicUserId && !targetStoreId) {
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', magicUserId).maybeSingle();
          if (profile) {
            setIsDemo(false);
            setUserName(profile.full_name);
            setUserRole(profile.role as any);

            if (profile.role === 'owner') {
              const { data: storesList } = await supabase.from('stores').select('id, name, address, business_type').eq('owner_id', profile.id);
              if (storesList && storesList.length > 0) {
                setStores(storesList);
                setSelectedStore(null); // Force selection for Hub feel
              }
            } else if (profile.store_id) {
              const { data: empStore } = await supabase.from('stores').select('id, name, address, business_type').eq('id', profile.store_id).single();
              if (empStore) {
                setStores([empStore]);
                setSelectedStore(empStore);
              }
            }
            setLoading(false);
            return;
          }
        }

        // B. Loading a Specific Store (s=...)
        if (targetStoreId) {
          const { data: store, error: storeError } = await supabase.from('stores').select('id, name, address, business_type').eq('id', targetStoreId).single();
          
          if (!storeError && store) {
            setIsDemo(false);
            setSelectedStore(store);
            localStorage.setItem('last_store_id', targetStoreId);

            // FETCH ALL STORES if we have a user ID (to allow switching)
            if (magicUserId) {
              const { data: storesList } = await supabase.from('stores').select('id, name, address, business_type').eq('owner_id', magicUserId);
              if (storesList && storesList.length > 0) {
                setStores(storesList);
              } else {
                setStores([store]);
              }
            } else {
              setStores([store]);
            }

            // Fetch profile for this session
            let profileQuery = supabase.from('profiles').select('full_name, role');
            if (magicUserId) {
              profileQuery = profileQuery.eq('id', magicUserId);
            } else {
              profileQuery = profileQuery.eq('store_id', targetStoreId).eq('role', 'owner');
            }
            
            const { data: profile } = await profileQuery.maybeSingle();
            if (profile) {
              setUserName(profile.full_name);
              setUserRole(profile.role as any);
            } else if (!magicUserId) {
              setUserRole('owner');
            }

            setLoading(false);
            return;
          } else {
            localStorage.removeItem('last_store_id');
          }
        }

        // --- 2. LOGGED IN SESSION ENTRY ---
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setIsDemo(false);
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
          const { data: storesList } = await supabase.from('stores').select('id, name, address, business_type').eq('owner_id', user.id);
          
          if (storesList && storesList.length > 0) {
            setStores(storesList);
            setUserRole('owner');
            
            const lastId = localStorage.getItem('last_store_id');
            const saved = storesList.find(s => s.id === lastId);
            if (storesList.length === 1) setSelectedStore(storesList[0]);
            else if (saved) setSelectedStore(saved);
            else setSelectedStore(null);
            
            setUserName(profile?.full_name || user.email || 'Dueño');
          } else if (profile) {
            setUserRole(profile.role as any);
            setUserName(profile.full_name);
            if (profile.store_id) {
              const { data: store } = await supabase.from('stores').select('id, name, address, business_type').eq('id', profile.store_id).single();
              if (store) {
                setStores([store]);
                setSelectedStore(store);
              }
            }
          }
          setLoading(false);
          return;
        }

        // --- 3. FALLBACK TO DEMO ---
        console.warn('Usando modo Demo (Sin sesión ni Magic Link)');
        setStores([DEMO_STORE]);
        setSelectedStore(DEMO_STORE);
        setIsDemo(true);
        setUserRole('owner');
        setLoading(false);
      } catch (err) {
        console.error('Error en StoreContext:', err);
        setLoading(false);
      }
    }

    fetchStores();
  }, []);

  const logout = async () => {
    localStorage.removeItem('last_store_id');
    await supabase.auth.signOut();
    window.location.reload();
  };

  const handleSetSelectedStore = (store: Store) => {
    setSelectedStore(store);
    localStorage.setItem('last_store_id', store.id);
  };

  return (
    <StoreContext.Provider value={{ 
      selectedStore, 
      stores, 
      setSelectedStore: handleSetSelectedStore, 
      loading, 
      isDemo, 
      userName, 
      userRole, 
      logout 
    }}>
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
