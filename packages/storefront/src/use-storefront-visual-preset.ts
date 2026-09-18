import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';

import { normalizeStorefrontVisualPreset } from '../../storefront-content-plugin/src/visual-presets';

import { type ShopApi } from './api';
import { storefrontQueryKeys } from './query-client';
import { type MarketConfig } from './types';

export function applyStorefrontVisualPreset(root: HTMLElement, value: unknown): () => void {
    const presetId = normalizeStorefrontVisualPreset(value);
    root.dataset.storefrontPreset = presetId;
    return () => {
        delete root.dataset.storefrontPreset;
    };
}

export function useStorefrontVisualPreset(
    api: Pick<ShopApi, 'storefrontVisualPreset'>,
    market: MarketConfig,
    languageCode: string,
    enabled = true,
) {
    const query = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCode),
            'visual-preset',
        ],
        queryFn: ({ signal }) => api.storefrontVisualPreset(signal),
        enabled,
        staleTime: 0,
        // Do not persist a style selection under an unverified store context.
    });
    // Theme loading stays independent of route rendering, so slow requests never unmount a form.
    const presetId = normalizeStorefrontVisualPreset(enabled ? query.data?.presetId : undefined);
    useLayoutEffect(() => {
        const cleanup = applyStorefrontVisualPreset(document.documentElement, presetId);
        if (query.data?.presetId) {
            try {
                sessionStorage.setItem('__storefront_preset__', presetId);
                localStorage.setItem('__storefront_preset__', presetId);
            } catch {
                // Storage may be unavailable in private browsing mode
            }
        }
        return cleanup;
    }, [presetId, query.data?.presetId]);
    return { presetId };
}
