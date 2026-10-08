import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { storefrontClientPluginCatalog } from '../../../storefront-content-plugin/src/client-plugin-manifest';
import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { normalizeStorefrontVisualPreset } from '../../../storefront-content-plugin/src/visual-presets';
import { fixtureData } from '../../../storefront/e2e/visual-presets/fixtures.mjs';
import type { ShopApi } from '../../../storefront/src/api';
import { DesktopLayoutContext, useDesktopViewport } from '../../../storefront/src/desktop-layout';
import { useStorefrontPublicData } from '../../../storefront/src/hooks/useStorefrontPublicData';
import { BusinessServicesPage } from '../../../storefront/src/pages/business-services-page';
import { BusinessServicesPageContext } from '../../../storefront/src/storefront-page-contexts';
import { HomeDualCategoryShowcase } from '../../../storefront/src/storefront-ui/content-ui';
import clientStyles from '../../../storefront/src/styles.css?inline';
import desktopStyles from '../../../storefront/src/styles/desktop-layout.css?inline';
import presetStyles from '../../../storefront/src/styles/visual-presets.css?inline';
import type { StorefrontContentBlock as ClientBlock } from '../../../storefront/src/types';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import '../../src/index.css';
import { ClientPluginsModule } from '../../src/pages/Plugins/ClientPluginsModule';
import { BusinessServicesCopyModule } from '../../src/pages/Storefront/BusinessServicesCopyModule';
import { StorefrontContentModule } from '../../src/pages/Storefront/StorefrontContentModule';
import { StorefrontModule } from '../../src/pages/Storefront/StorefrontModule';
import { newContentBlock, newContentItem } from '../../src/pages/Storefront/storefront-content-utils';
import { decorationDraft } from '../../src/pages/Storefront/storefront-decoration-model';
import { contentPublicationStatus } from '../../src/pages/Storefront/storefront-publication';
import { EditorialHomeClient } from './editorial-home-client';
import { editorialHomeBlocks } from './editorial-home-fixture';

// Isolated browser fixture. No HTTP link, account, or store data is used.
const params = new URLSearchParams(location.search);
const blockStorageKey = params.has('editorialHome')
    ? 'carousel-fixture-editorial-home-blocks'
    : 'carousel-fixture-blocks';
const asset = {
    __typename: 'Asset',
    id: 'fixture-asset',
    name: '轮播测试素材',
    type: 'IMAGE',
    mimeType: 'image/svg+xml',
    preview: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520"><rect width="1600" height="520" fill="#bccbb5"/><rect x="940" y="70" width="340" height="390" rx="24" fill="#eef1e4"/><circle cx="260" cy="160" r="70" fill="#e8c38e"/></svg>')}`,
    source: '',
    width: 1600,
    height: 520,
};
asset.source = '/assets/fixture-carousel.svg';
const replacementAsset = {
    ...asset,
    id: 'replacement-asset',
    name: '替换轮播横幅',
    preview: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520"><rect width="1600" height="520" fill="#445a78"/><rect x="1040" y="70" width="350" height="390" fill="#f3c99a"/></svg>')}`,
    source: '/assets/replacement-carousel.svg',
};
let servicesAsset = asset;
let blocks = params.has('empty')
    ? []
    : [
          ['notice', 'NOTICE', '服务公告'],
          ['hero-a', 'HERO', '生活好物'],
          ['hero-b', 'HERO', '留学服务'],
          ['hero-c', 'HERO', 'AI 订阅'],
          ['products', 'BEST_SELLERS', '热门商品'],
          ['legal', 'LEGAL', '隐私条款'],
      ].map(([id, type, name], position) => ({
          ...newContentBlock(type as 'HERO', position, name),
          __typename: 'StorefrontContentBlock',
          id,
          code: id,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
          enabled: id !== 'hero-c',
          imageAsset: type === 'HERO' ? asset : null,
          imageUrl: type === 'HERO' ? asset.preview : null,
      }));
if (params.has('editorialHome')) {
    const artworkBase = params.get('artworkBase');
    if (!artworkBase || !/^http:\/\/127\.0\.0\.1:\d+(?:\/@fs\/[^?#]+\/assets)?$/u.test(artworkBase)) {
        throw new Error('轮播设计夹具需要明确的本地素材地址');
    }
    blocks = editorialHomeBlocks(artworkBase).map(block => ({
        ...block,
        __typename: 'StorefrontContentBlock',
    })) as typeof blocks;
}
if (params.has('auth')) {
    blocks = fixtureData('classic', false)
        .storefrontContent.filter(block => block.type === 'AUTH_LOGIN' || block.type === 'AUTH_REGISTER')
        .map((block, position) => ({
            ...newContentBlock(block.type as 'AUTH_LOGIN' | 'AUTH_REGISTER', position, block.title),
            __typename: 'StorefrontContentBlock',
            id: block.id,
            code: block.code,
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
            enabled: true,
            imageUrl: '/assets/fixture-auth.svg',
            imageAsset: {
                ...asset,
                preview: '/assets/fixture-auth.svg',
                source: '/assets/fixture-auth.svg',
                width: 1391,
                height: 1131,
            },
            settings: {},
        }));
}
if (params.has('original')) {
    for (const block of blocks) {
        if (block.type === 'HERO') block.settings = { ...block.settings, themePreset: 'bright' };
    }
}
if (params.has('managedImages')) {
    const hero = blocks.find(block => block.id === 'hero-a')!;
    if (params.has('tallHero')) {
        asset.height = 1000;
        hero.imageAsset = {
            ...asset,
            preview: '/assets/fixture-carousel.svg?tall=1',
            source: '/assets/fixture-carousel.svg?tall=1',
        };
    }
    if (params.has('heroStats')) {
        hero.items = Array.from({ length: 8 }, (_, position) => {
            const item = newContentItem(position);
            item.translations[0].label = `布局示例 ${position + 1}`;
            item.translations[0].description = `已配置统计说明 ${position + 1}`;
            return item;
        });
    }
    for (const block of blocks) if (block.id === 'hero-b') block.enabled = false;
    Object.assign(hero.translations[0], {
        title: '为马来西亚的家，甄选舒适好物',
        subtitle: 'FLASH CAST · HOME & LIVING',
        body: '从卧室、客厅到餐厅与书房，为日常空间挑选耐看、实用的家具与家居。',
        ctaLabel: '浏览家具',
    });
    hero.targetType = 'PAGE';
    hero.targetValue = 'category';
    const trust = newContentBlock('TRUST_BAR', 2, '服务保障');
    trust.enabled = true;
    trust.items = ['马币标价', '订单可查', '在马客服', '按需询价'].map((label, position) => {
        const item = newContentItem(position);
        item.translations[0].label = label;
        return item;
    });
    const account = newContentBlock('ACCOUNT_HERO', 0, '账户页主图');
    blocks.push(
        ...[trust, account].map((block, index) => ({
            ...block,
            __typename: 'StorefrontContentBlock',
            id: `managed-image-${index}`,
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
            imageAsset: index === 1 ? asset : null,
            imageUrl: index === 1 ? asset.preview : null,
        })),
    );
}
if (params.has('gallery')) {
    const gallery = newContentBlock('QUICK_LINKS', 3, '精选分类');
    gallery.id = 'gallery';
    gallery.code = 'gallery';
    gallery.enabled = true;
    gallery.items = Array.from({ length: 5 }, (_, index) => {
        const item = newContentItem(index);
        item.id = `gallery-${index}`;
        item.imageUrl = '/assets/fixture-carousel.svg';
        item.targetType = 'PAGE';
        item.targetValue = 'category';
        item.translations[0].label = ['签证留学', '第二家园', '正品烟草', '精品白酒', '正厂槟榔'][index];
        return item;
    });
    blocks.push({
        ...gallery,
        __typename: 'StorefrontContentBlock',
        id: 'gallery',
        code: 'gallery',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        imageAsset: null,
        imageUrl: null,
    });
}
if (params.has('plugins')) {
    const pluginBlock = newContentBlock('CLIENT_PLUGINS', 10_001, '客户端插件配置');
    blocks.push({
        ...pluginBlock,
        __typename: 'StorefrontContentBlock',
        id: 'client-plugins',
        code: 'storefront-client-plugins',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        enabled: true,
        imageAsset: null,
        imageUrl: null,
        items: storefrontClientPluginCatalog.map((definition, index) => ({
            id: definition.code,
            enabled: true,
            position: index,
            imageUrl: null,
            targetType: 'NONE',
            translations: [],
            settings: {
                pluginCode: definition.code,
                placement: definition.defaultPlacement,
                categoryScope: 'ALL',
                categoryIds: [],
                includeChildren: true,
            },
        })),
    });
    if (params.has('unknown-plugin'))
        blocks[blocks.length - 1].items.push({
            ...blocks[blocks.length - 1].items[0],
            id: 'future-plugin',
            settings: {
                ...blocks[blocks.length - 1].items[0].settings,
                pluginCode: 'future-english-internal-plugin-key',
            },
        });
}
if (params.has('services') || params.has('services-client')) {
    // Optional review artwork stays local to this synthetic fixture, never in merchant content.
    const artworkUrl = params.get('artwork');
    servicesAsset = artworkUrl
        ? {
              ...asset,
              mimeType: 'image/png',
              preview: artworkUrl,
              source: artworkUrl,
              width: 1983,
              height: 793,
          }
        : asset;
    blocks.push({
        ...newContentBlock('CLIENT_PLUGINS', 10_001, '客户端插件配置'),
        __typename: 'StorefrontContentBlock',
        id: 'services-copy',
        code: 'storefront-client-plugins',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        enabled: !params.has('services-disabled'),
        imageAsset: servicesAsset,
        imageUrl: servicesAsset.preview,
        settings: { version: 1, page: 'category', businessServicesCopyVersion: 1 },
        translations: [
            {
                languageCode: 'zh_Hans',
                title: '商业服务',
                subtitle: '',
                body: '为您提供多种服务。',
                ctaLabel: '',
            },
            {
                languageCode: 'en',
                title: 'Business services',
                subtitle: '',
                body: 'Explore our services.',
                ctaLabel: '',
            },
        ],
    });
}
if (params.has('support')) {
    const supportBlock = newContentBlock('SUPPORT', 10_002, '客服中心');
    blocks.push({
        ...supportBlock,
        __typename: 'StorefrontContentBlock',
        id: 'support-page',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        enabled: true,
        imageAsset: asset,
        imageUrl: asset.preview,
        items: supportBlock.items.map(item =>
            item.settings?.supportChannel === 'QQ'
                ? { ...item, enabled: true, settings: { ...item.settings, supportAccount: '12345678' } }
                : item,
        ),
        settings: {
            serviceDaysZh: '每日',
            serviceDaysEn: 'Daily',
            serviceStartTime: '09:00',
            serviceEndTime: '18:00',
            supportFaqs: [
                {
                    id: 'contact',
                    enabled: true,
                    questionZh: '如何联系客服？',
                    answerZh: '请使用页面上的联系方式。',
                    questionEn: 'How can I contact support?',
                    answerEn: 'Use a contact method on this page.',
                },
            ],
        },
    });
}
if (params.has('recommendations')) {
    blocks.push({
        ...newContentBlock('RECOMMENDATIONS', 10_003, '猜你喜欢'),
        __typename: 'StorefrontContentBlock',
        id: 'recommendations',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        enabled: true,
        imageAsset: null,
        imageUrl: null,
        translations: [
            { languageCode: 'zh_Hans', title: '猜你喜欢', subtitle: '继续发现好物', body: '', ctaLabel: '' },
            {
                languageCode: 'en',
                title: 'You may also like',
                subtitle: 'Keep discovering',
                body: '',
                ctaLabel: '',
            },
        ],
    });
}
if (params.has('notice-period')) {
    const notice = blocks.find(block => block.type === 'NOTICE');
    if (notice) {
        const noticeSettings = { ...notice.settings };
        const period = params.get('notice-period');
        if (period === 'legacy') delete noticeSettings.announcementDisplayPeriod;
        else noticeSettings.announcementDisplayPeriod = period;
        notice.settings = noticeSettings;
    }
}
if (params.has('persist') && sessionStorage.getItem(blockStorageKey)) {
    blocks = JSON.parse(sessionStorage.getItem(blockStorageKey)!);
}
let interval = 6;
let announcements = params.has('persist')
    ? JSON.parse(sessionStorage.getItem('storefront-fixture-announcements') ?? '[]')
    : [];
if (params.has('sharing-records')) {
    blocks.push({
        ...blocks[0],
        id: 'sharing-poster',
        code: 'referral-poster-brand-minimal',
        type: 'CUSTOM',
        internalName: '分享海报 · 清透蓝白',
        enabled: true,
        settings: { purpose: 'referral-system-poster' },
        translations: blocks[0].translations.map(t => ({ ...t, title: '分享海报 · 清透蓝白' })),
    });
}
if (params.has('content-sync')) {
    const core = newContentBlock('CORE_CATEGORIES', blocks.length, '同步验收双卡片');
    blocks.push({
        ...core,
        __typename: 'StorefrontContentBlock',
        id: 'sync-core',
        code: 'sync-core',
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z',
        enabled: false,
        imageAsset: null,
        imageUrl: null,
        items: ['中文入口一', '中文入口二'].map((label, position) => ({
            __typename: 'StorefrontContentItem',
            id: 'sync-card-' + position,
            enabled: true,
            position,
            imageAsset: null,
            imageUrl: null,
            targetType: 'URL',
            targetValue: '/category',
            settings: null,
            translations: [
                { languageCode: 'zh_Hans', label, description: '本地测试入口' },
                { languageCode: 'en', label: 'Card ' + position, description: 'Local test entry' },
            ],
        })),
    } as (typeof blocks)[number]);
}
const guestClient = new QueryClient();
const guestApi = {
    products: async () => [],
    collections: async () => [],
    activeStoreCommerceMode: async () => 'RETAIL',
    storefrontConfig: async () => ({}),
    storefrontContent: async () => ({
        blocks: blocks
            .filter(block => contentPublicationStatus(block, undefined, 'zh_Hans') === 'PUBLISHED')
            .map(block => ({
                ...block,
                ...block.translations.find(value => value.languageCode === 'zh_Hans'),
                items: block.items
                    .filter(item => item.enabled)
                    .map(item => ({
                        ...item,
                        ...item.translations.find(value => value.languageCode === 'zh_Hans'),
                    })),
            })),
        settings: settings(),
        flashSales: [],
        systemAnnouncements: [],
    }),
} as unknown as ShopApi;
export function GuestPreview() {
    const result = useStorefrontPublicData({
        api: guestApi,
        market: {
            code: 'sync-fixture',
            currencyCode: 'MYR',
            countryCode: 'MY',
            defaultLanguageCode: 'zh_Hans',
            locale: 'zh-CN',
            label: 'Sync fixture',
        },
        language: 'zh',
        vendureLanguageCode: 'zh_Hans',
        storefrontContextResolved: true,
        customerAuthenticated: false,
    });
    const block = result.contentBlocks.find(block => block.type === 'CORE_CATEGORIES');
    return (
        <section aria-label="未登录客户端同步预览" style={{ padding: 20 }}>
            <h2>未登录客户端同步预览</h2>
            <p>已发布双卡片：{block ? '已显示' : '未显示'}</p>
            {block && (
                <HomeDualCategoryShowcase
                    language="zh"
                    block={block as ClientBlock}
                    onContentTarget={() => {}}
                />
            )}
        </section>
    );
}
let revision = 0;
const operations: Array<{ name: string; variables: unknown }> = [];
const faults = { read: params.has('read-error'), write: false, delete: false, delayMs: 80 };
Object.assign(window, {
    carouselFixture: { operations, faults, state: () => ({ blocks, interval, announcements }) },
});
const settings = () => ({
    __typename: 'StorefrontContentSettings',
    heroAutoplayIntervalSeconds: interval,
    configuredBlockTypes: [...new Set(blocks.map(block => block.type))],
});
const storeChannel = {
    __typename: 'Channel',
    id: 'fixture',
    code: '轮播测试店铺',
    token: 'fixture',
    defaultLanguageCode: 'zh_Hans',
    availableLanguageCodes: ['zh_Hans', 'en'],
    customFields: { storefrontNameZh: '预览测试店铺', storefrontNameEn: 'Preview test store' },
};
const channel = params.has('platform-channel')
    ? {
          ...storeChannel,
          id: 'platform-fixture',
          code: '__default_channel__',
          token: 'platform-fixture',
          customFields: null,
      }
    : storeChannel;
// Public Shop responses for isolated real-client previews. No real store is contacted.
if (params.has('parity') || params.has('notice-period') || params.has('editorialHome')) {
    asset.preview = `/assets/fixture-carousel.svg${params.has('tallHero') ? '?tall=1' : ''}`;
    replacementAsset.preview = '/assets/replacement-carousel.svg';
    const periodAnnouncements = [35, 49, 65].map((daysAgo, index) => {
        const startsAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
        return {
            id: `notice-period-${index + 1}`,
            createdAt: startsAt,
            startsAt,
            endsAt: null,
            linkUrl: null,
            titleZh: ['示例商城上线公告', '示例选购与询价说明', '示例配送与收货须知'][index],
            titleEn: ['Sample store launch', 'Sample buying and enquiries', 'Sample delivery information'][
                index
            ],
            contentZh: `本地样例公告，发布日期为 ${daysAgo} 天前。`,
            contentEn: `Local sample notice published ${daysAgo} days ago.`,
        };
    });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname === '/shop-api') {
            if (
                params.has('notice-period') &&
                url.hostname !== 'fixture.invalid' &&
                url.origin !== location.origin
            )
                throw new Error('公告期限样例仅允许本地夹具接口');
            const data = fixtureData(
                params.get('preset') ?? 'classic',
                false,
                params.has('auth') || params.has('managedImages') ? 'auth-referral' : 'normal',
            );
            data.activeChannel = { ...data.activeChannel, id: channel.id, code: channel.code };
            data.storefrontVisualPreset.channelId = channel.id;
            if (params.has('managedImages'))
                data.storefrontDailyRecommendations = {
                    businessDate: '2026-10-03',
                    expiresAt: '2099-01-01T00:00:00Z',
                    items: data.products.items,
                };
            data.storefrontContent = blocks
                .map(block =>
                    decorationDraft(block, url.searchParams.get('languageCode') === 'en' ? 'en' : 'zh_Hans'),
                )
                .filter(draft => draft.visible)
                .map(draft => draft.block);
            if (params.has('notice-period')) {
                const english = url.searchParams.get('languageCode') === 'en';
                data.activeSystemAnnouncements = periodAnnouncements.map(announcement => ({
                    id: announcement.id,
                    createdAt: announcement.createdAt,
                    startsAt: announcement.startsAt,
                    endsAt: announcement.endsAt,
                    linkUrl: announcement.linkUrl,
                    title: english ? announcement.titleEn : announcement.titleZh,
                    content: english ? announcement.contentEn : announcement.contentZh,
                }));
            }
            return new Response(JSON.stringify({ data }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return nativeFetch(input, init);
    };
}
const otherChannel = {
    __typename: 'Channel',
    id: 'other-fixture',
    code: 'other-fixture',
    customFields: { storefrontNameZh: '第二测试店铺', storefrontNameEn: 'Second test store' },
};
const storeChannels = [storeChannel, otherChannel];
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const timer = setTimeout(() => {
                    try {
                        const name = operation.operationName;
                        const { input, ids, id } = operation.variables;
                        operations.push({ name, variables: structuredClone(operation.variables) });
                        const mutation = /Create|Update|Delete|Reorder/.test(name);
                        if (mutation && faults.write) throw new Error('模拟保存失败，请重试');
                        let data: Record<string, unknown>;
                        if (name === 'NextAdminStorefrontPluginCollections') {
                            data = {
                                collections: { items: [], totalItems: 0 },
                                selectedCollections: { items: [], totalItems: 0 },
                            };
                        } else if (name === 'NextAdminStorefrontContent') {
                            if (faults.read) throw new Error('模拟内容读取失败');
                            data = {
                                activeChannel: channel,
                                storefrontContentSettings: settings(),
                                storefrontContentBlocks: blocks,
                                storefrontAuthConfiguration: {
                                    emailPasswordEnabled: true,
                                    emailAutoRegistrationEnabled: false,
                                    emailQuickRegistrationEnabled: false,
                                    googleOverrideEnabled: false,
                                    storeGoogleEnabled: false,
                                    storeGoogleClientId: null,
                                    platformGoogleEnabled: false,
                                    platformGoogleClientId: null,
                                    effectiveGoogleEnabled: false,
                                    effectiveGoogleClientId: null,
                                    googleConfigurationSource: 'DISABLED',
                                },
                            };
                        } else if (name === 'NextAdminStorefrontPreviewDomains') {
                            data = {
                                storeDomains: [
                                    { domain: 'fixture.invalid', isPrimary: true, status: 'ACTIVE', channel },
                                ],
                            };
                        } else if (name === 'NextAdminStorefrontPreviewUrl') {
                            data = { activeChannel: channel, storeProfiles: [] };
                        } else if (name === 'NextAdminStorefrontVisualPreset') {
                            data = {
                                activeChannel: channel,
                                storefrontVisualPreset: {
                                    __typename: 'StorefrontVisualPreset',
                                    channelId: 'fixture',
                                    presetId: params.get('preset') ?? 'classic',
                                    revision: 'default',
                                },
                                storefrontPreviewBranding: {
                                    channelId: channel.id,
                                    name: '预览测试店铺',
                                    backgroundColor: null,
                                    primaryColor: null,
                                    accentColor: null,
                                    highlightColor: null,
                                },
                            };
                        } else if (name === 'StorefrontPreviewBranding') {
                            data = {
                                activeChannel: channel,
                                storefrontVisualPreset: { presetId: params.get('preset') ?? 'classic' },
                                storefrontPreviewBranding: {
                                    channelId: channel.id,
                                    name: '预览测试店铺',
                                    backgroundColor: null,
                                    primaryColor: null,
                                    accentColor: null,
                                    highlightColor: null,
                                },
                            };
                        } else if (name === 'NextAdminStorefrontEditorOptions') {
                            data = { products: { items: [], totalItems: 0 } };
                        } else if (name === 'GetAssets') {
                            data = { assets: { items: [servicesAsset, replacementAsset], totalItems: 2 } };
                        } else if (name === 'NextAdminBannerCollections') {
                            data = { collections: { items: [], totalItems: 0 } };
                        } else if (name === 'NextAdminSystemAnnouncements') {
                            data = { systemAnnouncements: announcements };
                        } else if (name === 'NextAdminSystemAnnouncementChannels') {
                            data = { channels: { items: [channel, ...storeChannels] } };
                        } else if (name === 'NextAdminCreateSystemAnnouncement') {
                            const next = {
                                ...input,
                                ownerChannelId: channel.code === '__default_channel__' ? null : channel.id,
                                channels:
                                    input.targetMode === 'ALL'
                                        ? []
                                        : storeChannels.filter(item => input.channelIds.includes(item.id)),
                                id: `announcement-${++revision}`,
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                            };
                            announcements = [...announcements, next];
                            if (params.has('persist')) {
                                sessionStorage.setItem(
                                    'storefront-fixture-announcements',
                                    JSON.stringify(announcements),
                                );
                            }
                            data = { createSystemAnnouncement: next };
                        } else if (name === 'NextAdminUpdateSystemAnnouncement') {
                            const previous = announcements.find(item => item.id === input.id);
                            if (!previous) throw new Error('模拟公告不存在');
                            const next = {
                                ...previous,
                                ...input,
                                channels:
                                    input.targetMode === 'ALL'
                                        ? []
                                        : storeChannels.filter(item => input.channelIds.includes(item.id)),
                                updatedAt: new Date().toISOString(),
                            };
                            announcements = announcements.map(item => (item.id === input.id ? next : item));
                            if (params.has('persist')) {
                                sessionStorage.setItem(
                                    'storefront-fixture-announcements',
                                    JSON.stringify(announcements),
                                );
                            }
                            data = { updateSystemAnnouncement: next };
                        } else if (name === 'NextAdminReorderStorefrontBlocks') {
                            if (
                                ids.length !== blocks.length ||
                                new Set(ids).size !== blocks.length ||
                                blocks.some(block => !ids.includes(block.id))
                            )
                                throw new Error('排序遗漏或重复了内容');
                            blocks = ids.map((blockId: string, position: number) => ({
                                ...blocks.find(block => block.id === blockId)!,
                                position,
                                updatedAt: String(++revision),
                            }));
                            data = { reorderStorefrontContentBlocks: blocks };
                        } else if (name === 'NextAdminUpdateStorefrontSettings') {
                            interval = input.heroAutoplayIntervalSeconds;
                            data = { updateStorefrontContentSettings: settings() };
                        } else if (name === 'NextAdminDeleteStorefrontBlock') {
                            if (!faults.delete) blocks = blocks.filter(block => block.id !== id);
                            data = {
                                deleteStorefrontContentBlock: {
                                    result: faults.delete ? 'NOT_DELETED' : 'DELETED',
                                    message: faults.delete ? '模拟删除被拒绝' : null,
                                },
                            };
                        } else if (
                            name === 'NextAdminUpdateStorefrontBlock' ||
                            name === 'NextAdminCreateStorefrontBlock'
                        ) {
                            const previous = blocks.find(block => block.id === input.id);
                            if (previous && previous.updatedAt !== input.expectedUpdatedAt)
                                throw new Error('内容版本不一致');
                            const next = {
                                ...newContentBlock(
                                    input.type ?? previous?.type ?? 'HERO',
                                    input.position ?? previous?.position ?? blocks.length,
                                ),
                                ...previous,
                                ...input,
                                __typename: 'StorefrontContentBlock',
                                id: previous?.id ?? `new-${++revision}`,
                                createdAt: previous?.createdAt ?? '2026-09-06T00:00:00Z',
                                updatedAt: String(++revision),
                            };
                            if (previous && Array.isArray(input.translations)) {
                                // Match the server's locale merge: untouched English is omitted from writes.
                                next.translations = [
                                    ...previous.translations.map(translation => ({
                                        ...translation,
                                        ...input.translations.find(
                                            update => update.languageCode === translation.languageCode,
                                        ),
                                    })),
                                    ...input.translations.filter(
                                        update =>
                                            !previous.translations.some(
                                                translation =>
                                                    translation.languageCode === update.languageCode,
                                            ),
                                    ),
                                ];
                            }
                            if ('imageAssetId' in input) {
                                next.imageAsset = input.imageAssetId
                                    ? previous?.imageAsset?.id === input.imageAssetId
                                        ? previous.imageAsset
                                        : input.imageAssetId === replacementAsset.id
                                          ? replacementAsset
                                          : servicesAsset
                                    : null;
                            }
                            blocks = previous
                                ? blocks.map(block => (block.id === next.id ? next : block))
                                : [...blocks, next];
                            if (params.has('persist')) {
                                sessionStorage.setItem(blockStorageKey, JSON.stringify(blocks));
                            }
                            data = {
                                [previous ? 'updateStorefrontContentBlock' : 'createStorefrontContentBlock']:
                                    next,
                            };
                        } else throw new Error(`Unexpected fixture operation: ${name}`);
                        const normalizeBlock = (block: (typeof blocks)[number]) => ({
                            ...block,
                            ...block.translations[0],
                            id: block.id,
                            translations: block.translations.map((translation, index) => ({
                                ...translation,
                                id: translation.id ?? `translation-${block.id}-${index}`,
                            })),
                            items: block.items.map((item, index) => ({
                                ...item,
                                ...item.translations[0],
                                id: item.id ?? `item-${block.id}-${index}`,
                                translations: item.translations.map((translation, languageIndex) => ({
                                    ...translation,
                                    id: translation.id ?? `item-translation-${index}-${languageIndex}`,
                                })),
                            })),
                        });
                        for (const key of ['storefrontContentBlocks', 'reorderStorefrontContentBlocks']) {
                            if (Array.isArray(data[key])) data[key] = data[key].map(normalizeBlock);
                        }
                        for (const key of ['updateStorefrontContentBlock', 'createStorefrontContentBlock']) {
                            if (data[key]) data[key] = normalizeBlock(data[key] as (typeof blocks)[number]);
                        }
                        observer.next({ data: structuredClone(data) });
                        observer.complete();
                    } catch (error) {
                        observer.error(error);
                    }
                }, faults.delayMs);
                return () => clearTimeout(timer);
            }),
    ),
});

/** Uses the actual services page and typed providers with this fixture's saved blocks only. */
export function ServicesClientFixture() {
    const [language, setLanguage] = useState<'zh_Hans' | 'en'>(
        params.get('language') === 'en' ? 'en' : 'zh_Hans',
    );
    const [preset, setPreset] = useState(normalizeStorefrontVisualPreset(params.get('preset')));
    const [copy, setCopy] = useState('saved');
    const desktop = useDesktopViewport();
    const palette = resolveStorefrontSemanticPalette(preset);
    const variables = {
        ...semanticPaletteCssVariables(palette),
        ...storefrontSkinCssVariables(preset, palette),
    };
    const variableStyles = Object.entries(variables)
        .map(([key, value]) => `${key}:${value}`)
        .join(';');
    useLayoutEffect(() => {
        const previous = document.documentElement.dataset.storefrontPreset;
        document.documentElement.dataset.storefrontPreset = preset;
        return () => {
            if (previous === undefined) delete document.documentElement.dataset.storefrontPreset;
            else document.documentElement.dataset.storefrontPreset = previous;
        };
    }, [preset]);
    const contentBlocks = blocks
        .filter(block => block.enabled)
        .map(block => {
            const converted = decorationDraft(block, language).block!;
            if (block.type !== 'CLIENT_PLUGINS') return converted;
            // Review artwork is a loopback URL, so it is deliberately outside the real public Asset path.
            converted.imageUrl = block.imageAsset?.preview || block.imageUrl;
            if (copy === 'long') {
                converted.title =
                    language === 'en'
                        ? 'Explore shared business tools, services, and benefits with editable store content'.slice(
                              0,
                              80,
                          )
                        : '智能服务帮助店铺连接工具权益与商业能力，中文标题可随时编辑并实时显示在图文预览中'.slice(
                              0,
                              40,
                          );
                converted.body = (
                    language === 'en'
                        ? 'Store-managed text remains editable and readable. Shared layouts preserve image bindings and support both languages. '
                        : '后台文字保持可编辑，布局由所有店铺共用，切换语言和布局都不会替换已有图片。'
                )
                    .repeat(6)
                    .slice(0, 200);
            }
            return converted;
        });
    return (
        <>
            <style>{`${clientStyles}\n${desktopStyles}\n${presetStyles}\n:root{${variableStyles}}`}</style>
            <div className="flex flex-wrap items-center gap-3 p-3" data-services-client-controls>
                <strong>本地客户端验收 · 示例数据</strong>
                <label>
                    语言{' '}
                    <select
                        aria-label="客户端验收语言"
                        value={language}
                        onChange={event => setLanguage(event.target.value as 'zh_Hans' | 'en')}
                    >
                        <option value="zh_Hans">中文</option>
                        <option value="en">English</option>
                    </select>
                </label>
                <label>
                    皮肤{' '}
                    <select
                        aria-label="客户端验收皮肤"
                        value={preset}
                        onChange={event => setPreset(normalizeStorefrontVisualPreset(event.target.value))}
                    >
                        <option value="classic">经典</option>
                        <option value="neo-minimalist">新锐科技极简</option>
                    </select>
                </label>
                <label>
                    文案{' '}
                    <select
                        aria-label="客户端验收文案"
                        value={copy}
                        onChange={event => setCopy(event.target.value)}
                    >
                        <option value="saved">保存的文案</option>
                        <option value="long">长度上限示例</option>
                    </select>
                </label>
            </div>
            <div className={`storefront-app ${desktop ? 'desktop-store-layout' : ''}`}>
                <BusinessServicesPageContext.Provider
                    value={{
                        contentBlocks,
                        language: language === 'en' ? 'en' : 'zh',
                        storefrontName: '预览测试店铺',
                        logoUrl: null,
                        marketLabel: '马来西亚',
                        displayCurrencyCode: 'MYR',
                        availableCurrencyCodes: ['MYR'],
                        currencyLoading: false,
                        onToggleLanguage: () => setLanguage(value => (value === 'en' ? 'zh_Hans' : 'en')),
                        onCurrencyChange: () => undefined,
                        onNotifications: () => undefined,
                        onNavigate: () => undefined,
                        onContentTarget: () => undefined,
                    }}
                >
                    <DesktopLayoutContext.Provider value={desktop}>
                        <BusinessServicesPage />
                    </DesktopLayoutContext.Provider>
                </BusinessServicesPageContext.Provider>
            </div>
        </>
    );
}

createRoot(document.getElementById('root')!).render(
    params.has('editorialHomeClient') ? (
        <EditorialHomeClient blocks={blocks} />
    ) : params.has('services-client') ? (
        <ServicesClientFixture />
    ) : (
        <React.Fragment>
            <FeatureHelpProvider>
                <ApolloProvider client={client}>
                    <AdminPermissionsProvider
                        permissions={
                            params.has('readonly')
                                ? ['ReadStorefrontContent']
                                : params.has('editor')
                                  ? [
                                        'ReadStorefrontContent',
                                        'UpdateStorefrontContent',
                                        'CreateStorefrontContent',
                                    ]
                                  : ['SuperAdmin']
                        }
                    >
                        <div className="bg-slate-900 px-4 py-2 text-xs text-white">
                            本地轮播管理验收 · 示例数据
                        </div>
                        <MemoryRouter
                            initialEntries={
                                params.has('announcements')
                                    ? ['/?tab=announcements']
                                    : params.has('banner')
                                      ? ['/storefront/decoration?panel=desktop-category-banners']
                                      : ['/']
                            }
                        >
                            <div style={{ height: 'calc(100dvh - 32px)' }}>
                                {params.has('plugins') ? (
                                    <ClientPluginsModule />
                                ) : params.has('services') ? (
                                    <BusinessServicesCopyModule />
                                ) : params.has('support') ||
                                  params.has('announcements') ||
                                  params.has('auth') ? (
                                    <StorefrontContentModule />
                                ) : (
                                    <StorefrontModule />
                                )}
                            </div>
                        </MemoryRouter>
                        {params.has('content-sync') && (
                            <QueryClientProvider client={guestClient}>
                                <GuestPreview />
                            </QueryClientProvider>
                        )}
                    </AdminPermissionsProvider>
                </ApolloProvider>
            </FeatureHelpProvider>
        </React.Fragment>
    ),
);
