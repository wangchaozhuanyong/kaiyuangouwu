import { createContext, useContext } from 'react';

import { type useStorefrontAppState } from './hooks/useStorefrontAppState';

export type StorefrontContextValue = ReturnType<typeof useStorefrontAppState>['storefrontContextValue'];

export const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront(): StorefrontContextValue {
    const context = useContext(StorefrontContext);
    if (!context) {
        throw new Error('useStorefront must be used within StorefrontContext.Provider');
    }
    return context;
}
