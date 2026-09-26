import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useState } from 'react';

import {
    isStorefrontVisualPresetId,
    normalizeStorefrontVisualPreset,
    type StorefrontVisualPresetId,
} from '../../storefront-content-plugin/src/visual-presets';

import { type ShopApi } from './api';
import { STOREFRONT_CONFIG_REFRESH_INTERVAL, storefrontQueryKeys } from './query-client';
import { type MarketConfig } from './types';

export function applyStorefrontVisualPreset(root: HTMLElement, value: unknown): () => void {
    const presetId = normalizeStorefrontVisualPreset(value);
    root.dataset.storefrontPreset = presetId;
    return () => {
        delete root.dataset.storefrontPreset;
    };
}

export function readStorefrontPreviewPreset(search: string): StorefrontVisualPresetId | null {
    const parameters = new URLSearchParams(search);
    if (parameters.get('storefrontPreviewEmbedded') !== '1') return null;
    const candidate = parameters.get('storefrontPreviewPreset');
    return isStorefrontVisualPresetId(candidate) ? candidate : null;
}

export function useStorefrontVisualPreset(
    api: Pick<ShopApi, 'storefrontVisualPreset'>,
    market: MarketConfig,
    languageCode: string,
    enabled = true,
) {
    // The preview iframe is remounted for a skin switch; internal SPA navigation
    // must not discard its selected skin when the route drops query parameters.
    const [previewPreset] = useState(() =>
        typeof window === 'undefined' ? null : readStorefrontPreviewPreset(window.location.search),
    );
    const query = useQuery({
        queryKey: [
            ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCode),
            'visual-preset',
        ],
        queryFn: ({ signal }) => api.storefrontVisualPreset(signal),
        enabled: enabled && !previewPreset,
        staleTime: 0,
        refetchInterval: STOREFRONT_CONFIG_REFRESH_INTERVAL,
        // Do not persist a style selection under an unverified store context.
    });
    // Theme loading stays independent of route rendering, so slow requests never unmount a form.
    const presetId =
        previewPreset ?? normalizeStorefrontVisualPreset(enabled ? query.data?.presetId : undefined);
    useLayoutEffect(() => {
        const cleanup = applyStorefrontVisualPreset(document.documentElement, presetId);
        if (!previewPreset && query.data?.presetId) {
            try {
                sessionStorage.setItem('__storefront_preset__', presetId);
                localStorage.setItem('__storefront_preset__', presetId);
            } catch {
                // Storage may be unavailable in private browsing mode
            }
        }
        return cleanup;
    }, [presetId, previewPreset, query.data?.presetId]);
    return { presetId };
}
