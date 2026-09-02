import React, { createContext, useContext } from 'react';
import type { ProductEditorFormState } from './useProductEditorForm';

const ProductEditorContext = createContext<ProductEditorFormState | null>(null);

export function ProductEditorProvider({
    value,
    children,
}: {
    value: ProductEditorFormState;
    children: React.ReactNode;
}) {
    return <ProductEditorContext.Provider value={value}>{children}</ProductEditorContext.Provider>;
}

export function useProductEditor(): ProductEditorFormState {
    const ctx = useContext(ProductEditorContext);
    if (!ctx) {
        throw new Error('useProductEditor must be used within ProductEditorProvider');
    }
    return ctx;
}
