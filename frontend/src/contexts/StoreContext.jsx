import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const { profile } = useAuth();
  const [currentStore, setCurrentStore] = useState(null);
  const [stores, setStores] = useState([]);

  const isInfrastructure = profile?.tier === 'infrastructure';

  useEffect(() => {
    if (!profile) {
      setStores([]);
      setCurrentStore(null);
      return;
    }

    if (isInfrastructure && profile.stores && profile.stores.length > 0) {
      setStores(profile.stores);
      // Auto-select first store if none selected, or user's assigned store
      if (!currentStore || !profile.stores.find(s => s.storeId === currentStore.storeId)) {
        if (profile.storeId) {
          const assigned = profile.stores.find(s => s.storeId === profile.storeId);
          if (assigned) {
            setCurrentStore(assigned);
            return;
          }
        }
        setCurrentStore(profile.stores[0]);
      }
    } else if (!isInfrastructure) {
      setStores([]);
      setCurrentStore(null);
    }
  }, [profile]);

  function selectStore(store) {
    setCurrentStore(store);
  }

  return (
    <StoreContext.Provider value={{
      currentStore,
      stores,
      selectStore,
      isInfrastructure,
      storeId: currentStore?.storeId || ''
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
