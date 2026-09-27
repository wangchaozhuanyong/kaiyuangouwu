import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useState } from 'react';

import {
    isStorefrontVisualPresetId,
    normalizeStorefrontVisualPreset,
    type StorefrontVisualPresetId,
} from '../../storefront-content-plugin/src/visual-presets';

import { type ShopApi } from './api';
import { STOREFRONT_CONFIG_REFRESH_INTERVAL, storefrontQueryKeys } from './query-client';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
import { restoredStorefrontTheme } from './storefront-theme-cache';
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
        typeof window === 'undefined'
            ? null
            : readStorefrontPreviewPreset(storefrontPreviewParameters().toString()),
    );
    const [restoredTheme] = useState(restoredStorefrontTheme);
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
    const restoredPreset =
        restoredTheme && (!enabled || restoredTheme.channelCode === market.code)
            ? restoredTheme.presetId
            : undefined;
    const presetId = previewPreset ?? normalizeStorefrontVisualPreset(query.data?.presetId ?? restoredPreset);
    const ready = Boolean(previewPreset || (enabled && (query.data || query.isError || restoredPreset)));
    useLayoutEffect(() => {
        if (!ready) return;
        const cleanup = applyStorefrontVisualPreset(document.documentElement, presetId);
        return cleanup;
    }, [presetId, ready]);
    return { presetId, ready, cache: !previewPreset && Boolean(query.data) };
}
