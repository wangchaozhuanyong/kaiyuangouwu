import { createContext, useContext } from 'react';
import type { ProductEditorFormState } from './useProductEditorForm';

export const ProductEditorContext = createContext<ProductEditorFormState | null>(null);

/** Optional extension consumers share the exact context used by the editor provider. */
export function useOptionalProductEditor(): ProductEditorFormState | null {
    return useContext(ProductEditorContext);
}
