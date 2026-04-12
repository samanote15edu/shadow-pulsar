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

        // 1. Check for Magic Link (URL) or LocalStorage
        const params = new URLSearchParams(window.location.search);
        let magicStoreId: string | null = params.get('s')?.trim() || null;
        
        // If not in URL, check localStorage
        if (!magicStoreId) {
          magicStoreId = localStorage.getItem('last_store_id');
        }

        if (magicStoreId) {
          setIsDemo(false); 
          const { data: magicStore, error: magicError } = await supabase
            .from('stores')
            .select('*')
            .eq('id', magicStoreId)
            .single();

          if (!magicError && magicStore) {
            // Save to localStorage for persistence
            localStorage.setItem('last_store_id', magicStoreId);
            
            setStores([magicStore]);
            setSelectedStore(magicStore);
            
            // 3. Fetch specific profile if 'u' is present, otherwise find owner
            const magicUserId = params.get('u')?.trim() || null;
            let query = supabase.from('profiles').select('full_name, role');
            
            if (magicUserId) {
              query = query.eq('id', magicUserId);
            } else {
              // Legacy/Fallback: Try to find the owner for this store
              query = query.eq('store_id', magicStoreId).eq('role', 'owner');
            }

            const { data: profile } = await query.maybeSingle();
            
            if (profile) {
              setUserName(profile.full_name);
              setUserRole(profile.role as any);
            } else if (!magicUserId) {
              // If no specific user and no owner found, default to owner for backward compatibility
              // (This might happen for first-time owners without a profile record yet)
              setUserRole('owner');
            }
            
            setLoading(false);
            return;
          } else {
            // If ID is invalid, clear it
            localStorage.removeItem('last_store_id');
          }
        }

        // 2. Fallback to standard Auth login
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          console.warn('Usando modo Demo (Sin sesión ni Magic Link)');
          setStores([DEMO_STORE]);
          setSelectedStore(DEMO_STORE);
          setIsDemo(true);
          setUserRole('owner'); // Demo is always owner for testing
          setLoading(false);
          return;
        }

        // Fetch profile to get role
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, full_name')
          .eq('id', user.id)
          .maybeSingle();

        const { data: storesList, error: storesError } = await supabase
          .from('stores')
          .select('*')
          .eq('owner_id', user.id);

        if (!storesError && storesList && storesList.length > 0) {
          setStores(storesList);
          setSelectedStore(storesList[0]);
          setUserName(profile?.full_name || user.user_metadata?.full_name || null);
          setUserRole((profile?.role as any) || 'employee');
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
    <StoreContext.Provider value={{ selectedStore, stores, setSelectedStore, loading, isDemo, userName, userRole, logout }}>
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
