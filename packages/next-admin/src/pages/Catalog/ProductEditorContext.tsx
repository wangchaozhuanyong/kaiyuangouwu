import React from 'react';
import { ProductEditorContext, useOptionalProductEditor } from './product-editor-context';
import type { ProductEditorFormState } from './useProductEditorForm';

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
    const ctx = useOptionalProductEditor();
    if (!ctx) {
        throw new Error('useProductEditor must be used within ProductEditorProvider');
    }
    return ctx;
}
