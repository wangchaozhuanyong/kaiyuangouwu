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

export function useStorefrontVisualPreset(api: ShopApi, market: MarketConfig, languageCode: string) {
    const query = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCode),
            'visual-preset',
        ],
        queryFn: ({ signal }) => api.storefrontVisualPreset(signal),
        staleTime: 0,
        refetchInterval: 60_000,
        // Do not persist a style selection under an unverified store context.
    });
    // Theme loading stays independent of route rendering, so slow requests never unmount a form.
    const presetId = normalizeStorefrontVisualPreset(query.data?.presetId);
    useLayoutEffect(() => applyStorefrontVisualPreset(document.documentElement, presetId), [presetId]);
}
