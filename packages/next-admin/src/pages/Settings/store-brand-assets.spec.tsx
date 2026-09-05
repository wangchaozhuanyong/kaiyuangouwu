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

function fixture(
    options: { partialAssignment?: boolean; assignmentError?: boolean; staleProfile?: boolean } = {},
) {
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
                    if (operation.operationName === 'AssignStoreBrandAssets') {
                        if (options.assignmentError) {
                            observer.error(new Error('素材分配失败'));
                            return;
                        }
                        observer.next({
                            data: {
                                assignAssetsToChannel: options.partialAssignment
                                    ? []
                                    : operation.variables.input.assetIds.map((id: string) => ({ id })),
                            },
                        });
                    } else {
                        if (options.staleProfile) {
                            observer.error(new Error('店铺档案已被其他管理员修改'));
                            return;
                        }
                        observer.next({ data: { updateStoreProfile: profile } });
                    }
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
    it('assigns shared assets first, then saves the same IDs into the target store with its version', async () => {
        const { client, calls } = fixture();
        await saveStoreProfileWithBrandAssets(client, profile, sharedDraft(), { storefrontNameZh: '大马通' });
        expect(calls).toEqual([
            {
                name: 'AssignStoreBrandAssets',
                channel: 'default-channel',
                input: { assetIds: ['new-icon', 'new-light', 'new-dark'], channelId: 'target-store' },
            },
            {
                name: 'NextAdminUpdateStoreProfile',
                channel: 'target-channel',
                input: {
                    id: profile.id,
                    expectedUpdatedAt: profile.updatedAt,
                    storefrontNameZh: '大马通',
                    logoAssetId: 'new-icon',
                    logoOnLightAssetId: 'new-light',
                    logoOnDarkAssetId: 'new-dark',
                },
            },
        ]);
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

    it.each([{ partialAssignment: true }, { assignmentError: true }])(
        'does not publish a profile after failed or incomplete assignment: %j',
        async options => {
            const { client, calls } = fixture(options);
            await expect(
                saveStoreProfileWithBrandAssets(client, profile, sharedDraft(), {}),
            ).rejects.toThrow();
            expect(calls.map(call => call.name)).toEqual(['AssignStoreBrandAssets']);
        },
    );

    it('deduplicates shared assets and leaves local assets in their own store', async () => {
        const { client, calls } = fixture();
        const draft = sharedDraft();
        draft.logoOnLightAsset = draft.logoAsset;
        draft.logoOnDarkAsset!.sourceChannelToken = profile.channel.token;
        await saveStoreProfileWithBrandAssets(client, profile, draft, {});
        expect(calls[0].input.assetIds).toEqual(['new-icon']);
        expect(calls[1].input).toMatchObject({
            logoAssetId: 'new-icon',
            logoOnLightAssetId: 'new-icon',
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
