import { createContext, useContext, type ReactNode } from 'react';
import type { Guide } from '../features/pack/catalog';

const CatalogContext = createContext<readonly Guide[] | null>(null);

export function CatalogProvider({
  catalog,
  children,
}: {
  catalog: readonly Guide[];
  children: ReactNode;
}) {
  return (
    <CatalogContext.Provider value={catalog}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog(): readonly Guide[] {
  const catalog = useContext(CatalogContext);
  if (catalog === null) {
    throw new Error('useCatalog needs a CatalogProvider above it');
  }
  return catalog;
}
