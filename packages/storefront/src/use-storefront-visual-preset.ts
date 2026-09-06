import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import type { ShopApi } from './api';
import type { MarketConfig } from './types';

import {
    normalizeStorefrontDesktopLayout,
    normalizeStorefrontVisualPreset,
} from '../../storefront-content-plugin/src/visual-presets';

import { storefrontQueryKeys } from './query-client';

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
        refetchInterval: 60_000,
        // Do not persist a style selection under an unverified store context.
    });
    // Theme loading stays independent of route rendering, so slow requests never unmount a form.
    const presetId = normalizeStorefrontVisualPreset(enabled ? query.data?.presetId : undefined);
    useLayoutEffect(() => applyStorefrontVisualPreset(document.documentElement, presetId), [presetId]);
    return {
        presetId,
        desktopLayout: normalizeStorefrontDesktopLayout(enabled ? query.data?.desktopLayout : undefined),
    };
}
