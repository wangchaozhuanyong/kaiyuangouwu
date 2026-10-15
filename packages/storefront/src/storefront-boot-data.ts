// organize-imports-ignore -- Preserve the ESLint type-import groups.
import type { StorefrontConfig } from './types';
import type { QueryClient } from '@tanstack/react-query';

import {
    STOREFRONT_BOOT_DATA_ELEMENT_ID,
    publicLanguageFromUrl,
    validateStorefrontBootData,
    type StorefrontBootData,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { SEND_CLIENT_CHANNEL_TOKEN } from './api/helpers';
import { languageCodeFor, marketForStorefrontConfig } from './i18n';
import { publicPageReadGeneration } from './public-page-transport';
import {
    isStorefrontScopeAccessDenied,
    markStorefrontPublicQuerySource,
    storefrontQueryKeys,
} from './query-client';
import { storefrontPreviewParameters } from './storefront-preview-parameters';
import { readStoredLanguage, readStoredSettlementCurrency } from './storefront-utils';

export type InitialStorefrontBoot = StorefrontBootData<StorefrontConfig>;
const generations = new WeakMap<InitialStorefrontBoot, number>();

/** Only a current, anonymous configuration from this exact host may bridge startup. */
export function readInitialStorefrontBoot(): InitialStorefrontBoot | undefined {
    if (typeof document === 'undefined' || SEND_CLIENT_CHANNEL_TOKEN) return;
    if (storefrontPreviewParameters().get('storefrontPreviewEmbedded') === '1') return;
    try {
        const value: unknown = JSON.parse(
            document.getElementById(STOREFRONT_BOOT_DATA_ELEMENT_ID)?.textContent ?? 'null',
        );
        if (!validateStorefrontBootData(value, { host: window.location.host })) return;
        const boot = value as InitialStorefrontBoot;
        const market = marketForStorefrontConfig(boot.config);
        if (
            !validateStorefrontBootData(boot, {
                host: window.location.host,
                languageCode:
                    publicLanguageFromUrl(window.location.pathname) ??
                    languageCodeFor(readStoredLanguage(market)),
                currencyCode: readStoredSettlementCurrency(market),
            })
        )
            return;
        generations.set(boot, publicPageReadGeneration());
        return boot;
    } catch {
        return;
    }
}

/** Use the sole query cache and preserve the age of the configuration, not SSI render time. */
export function seedStorefrontBoot(client: QueryClient, boot: InitialStorefrontBoot): void {
    const marketCode = `${boot.scope.channelCode}:${boot.scope.currencyCode}`;
    const languageCode = boot.scope.languageCode;
    if (
        !validateStorefrontBootData(boot, {
            host: typeof window === 'undefined' ? boot.scope.host : window.location.host,
        }) ||
        isStorefrontScopeAccessDenied(client, { marketCode, languageCode }) ||
        (generations.has(boot) && generations.get(boot) !== publicPageReadGeneration())
    )
        return;
    const seed = (key: readonly unknown[], data: unknown, updatedAt: number) => {
        if ((client.getQueryState(key)?.dataUpdatedAt ?? 0) > updatedAt) return;
        client.setQueryData(key, data, { updatedAt });
        markStorefrontPublicQuerySource(client, key, 'LIVE');
    };
    seed(
        [...storefrontQueryKeys.config(marketCode, languageCode), 'public'],
        boot.config,
        boot.configUpdatedAt,
    );
    if (
        Array.isArray(boot.media) &&
        typeof boot.mediaUpdatedAt === 'number' &&
        Date.now() - boot.mediaUpdatedAt <= 60_000 &&
        boot.mediaUpdatedAt <= Date.now() + 5_000
    )
        seed(
            [...storefrontQueryKeys.scope(marketCode, languageCode), 'public-media'],
            boot.media,
            boot.mediaUpdatedAt,
        );
    if (
        boot.visualPreset &&
        typeof boot.visualUpdatedAt === 'number' &&
        Date.now() - boot.visualUpdatedAt <= 60_000 &&
        boot.visualUpdatedAt <= Date.now() + 5_000
    )
        seed(
            [...storefrontQueryKeys.scope(marketCode, languageCode), 'visual-preset'],
            boot.visualPreset,
            boot.visualUpdatedAt,
        );
}
