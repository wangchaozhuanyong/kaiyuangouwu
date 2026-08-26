import { createContext, useContext } from 'react';

export type StorefrontContextValue = Record<string, unknown>;

export const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront<T extends object = StorefrontContextValue>(): T {
    const context = useContext(StorefrontContext);
    if (!context) {
        throw new Error('useStorefront must be used within StorefrontContext.Provider');
    }
    return context as T;
}
