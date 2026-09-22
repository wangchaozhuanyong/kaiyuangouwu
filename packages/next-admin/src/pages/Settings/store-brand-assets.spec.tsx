import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type { StoreProfileRecord } from '../../graphql/management.graphql';
import { StoreBrandAssets } from './StoreBrandAssets';
import {
    saveStoreProfileWithBrandAssets,
    storeProfileBrandAssets,
    type BrandAssetsDraft,
    type StoreBrandAsset,
} from './store-brand-assets';

const icon: StoreBrandAsset = { id: 'original-icon', preview: '/icon.png', source: '/icon.png' };
const profile: StoreProfileRecord = {
    id: 'store-profile',
    updatedAt: '2026-09-05T00:00:00.000Z',
    status: 'ACTIVE',
    sortOrder: 0,
    descriptionZh: '简介',
    descriptionEn: 'Description',
    taglineZh: null,
    taglineEn: null,
    brandBackgroundColor: null,
    brandPrimaryColor: null,
    brandAccentColor: null,
    brandHighlightColor: null,
    legalEntityName: null,
    legalRegistrationCountry: null,
    supportEmail: null,
    privacyEmail: null,
    internalNote: null,
    primaryDomain: null,
    storefrontUrl: null,
    isOperational: true,
    activationReadiness: { ready: true, checks: [] },
    logoAsset: icon,
    logoOnLightAsset: null,
    logoOnDarkAsset: null,
    channel: {
        id: 'target-store',
        code: '美宜佳',
        token: 'target-channel',
        defaultCurrencyCode: 'MYR',
        defaultLanguageCode: 'zh_Hans',
        seller: null,
        customFields: { storefrontNameZh: '大马通', storefrontNameEn: 'Damatong' },
    },
};

function fixture(options: { staleProfile?: boolean } = {}) {
    const calls: Array<{ name: string; input: Record<string, unknown>; channel: string }> = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    calls.push({
                        name: operation.operationName ?? '',
                        input: operation.variables.input,
                        channel: operation.getContext().headers['vendure-token'],
                    });
                    if (options.staleProfile) {
                        observer.error(new Error('店铺档案已被其他管理员修改'));
                        return;
                    }
                    observer.next({ data: { updateStoreProfile: profile } });
                    observer.complete();
                }),
        ),
    });
    return { client, calls };
}

function sharedDraft(): BrandAssetsDraft {
    return {
        logoAsset: { ...icon, id: 'new-icon', sourceChannelToken: 'default-channel' },
        logoOnLightAsset: { ...icon, id: 'new-light', sourceChannelToken: 'default-channel' },
        logoOnDarkAsset: { ...icon, id: 'new-dark', sourceChannelToken: 'default-channel' },
    };
}

describe('store brand publication', () => {
    it('rejects cross-store brand assets without writing the profile', async () => {
        const { client, calls } = fixture();
        await expect(
            saveStoreProfileWithBrandAssets(client, profile, sharedDraft(), { storefrontNameZh: '大马通' }),
        ).rejects.toThrow('不属于当前店铺');
        expect(calls).toEqual([]);
    });

    it('does not overwrite unchanged brand bindings when editing other profile fields', async () => {
        const { client, calls } = fixture();
        await saveStoreProfileWithBrandAssets(client, profile, storeProfileBrandAssets(profile), {
            taglineZh: '新口号',
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].input).toEqual({
            id: profile.id,
            expectedUpdatedAt: profile.updatedAt,
            taglineZh: '新口号',
        });
    });

    it('clears only the requested binding without deleting assets', async () => {
        const { client, calls } = fixture();
        await saveStoreProfileWithBrandAssets(
            client,
            profile,
            { ...storeProfileBrandAssets(profile), logoAsset: null },
            {},
        );
        expect(calls).toHaveLength(1);
        expect(calls[0].input).toEqual({
            id: profile.id,
            expectedUpdatedAt: profile.updatedAt,
            logoAssetId: null,
        });
    });

    it('saves changed assets directly when every asset belongs to the current store', async () => {
        const { client, calls } = fixture();
        const draft = sharedDraft();
        for (const asset of Object.values(draft)) {
            if (asset) asset.sourceChannelToken = profile.channel.token;
        }
        await saveStoreProfileWithBrandAssets(client, profile, draft, {});
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            name: 'NextAdminUpdateStoreProfile',
            channel: 'target-channel',
        });
        expect(calls[0].input).toMatchObject({
            logoAssetId: 'new-icon',
            logoOnLightAssetId: 'new-light',
            logoOnDarkAssetId: 'new-dark',
        });
    });

    it('keeps optimistic concurrency failures visible for the operator to refresh', async () => {
        const { client } = fixture({ staleProfile: true });
        await expect(
            saveStoreProfileWithBrandAssets(client, profile, storeProfileBrandAssets(profile), {}),
        ).rejects.toThrow('已被其他管理员修改');
    });

    it('exposes three distinct preview and selection slots', () => {
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <StoreBrandAssets
                    assets={storeProfileBrandAssets(profile)}
                    channel={profile.channel}
                    disabled={false}
                    onChange={() => undefined}
                />
            </FeatureHelpProvider>,
        );
        expect(html).toContain('aria-label="选择店铺图标"');
        expect(html).toContain('aria-label="选择浅色背景 Logo"');
        expect(html).toContain('aria-label="选择深色背景 Logo"');
        expect(html).toContain('aria-label="清除店铺图标"');
        expect(html).toContain('src="/icon.png"');
    });
});
