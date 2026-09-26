import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { ShopApi } from '../../../storefront/src/api';
import { useStorefrontPublicData } from '../../../storefront/src/hooks/useStorefrontPublicData';
import { HomeDualCategoryShowcase } from '../../../storefront/src/storefront-ui/content-ui';
import type { StorefrontContentBlock as ClientBlock } from '../../../storefront/src/types';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import '../../src/index.css';
import { BusinessServicesCopyModule } from '../../src/pages/Storefront/BusinessServicesCopyModule';
import { StorefrontContentModule } from '../../src/pages/Storefront/StorefrontContentModule';
import { StorefrontModule } from '../../src/pages/Storefront/StorefrontModule';
import { newContentBlock } from '../../src/pages/Storefront/storefront-content-utils';
import { contentPublicationStatus } from '../../src/pages/Storefront/storefront-publication';

// Isolated browser fixture. No HTTP link, account, or store data is used.
const params = new URLSearchParams(location.search);
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
if (params.has('services')) {
    blocks.push({
        ...newContentBlock('CLIENT_PLUGINS', 10_001, '客户端插件配置'),
        __typename: 'StorefrontContentBlock',
        id: 'services-copy',
        code: 'storefront-client-plugins',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        enabled: !params.has('services-disabled'),
        imageAsset: asset,
        imageUrl: asset.preview,
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
if (params.has('persist') && sessionStorage.getItem('carousel-fixture-blocks')) {
    blocks = JSON.parse(sessionStorage.getItem('carousel-fixture-blocks')!);
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
function GuestPreview() {
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
                        if (name === 'NextAdminStorefrontContent') {
                            if (faults.read) throw new Error('模拟内容读取失败');
                            data = {
                                activeChannel: channel,
                                storefrontContentSettings: settings(),
                                storefrontContentBlocks: blocks,
                            };
                        } else if (name === 'NextAdminStorefrontVisualPreset') {
                            data = {
                                activeChannel: channel,
                                storefrontVisualPreset: {
                                    __typename: 'StorefrontVisualPreset',
                                    channelId: 'fixture',
                                    presetId: params.get('preset') ?? 'classic',
                                    revision: 'default',
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
                            data = { assets: { items: [asset, replacementAsset], totalItems: 2 } };
                        } else if (name === 'NextAdminBannerCollections') {
                            data = { collections: { items: [], totalItems: 0 } };
                        } else if (name === 'NextAdminSystemAnnouncements') {
                            data = { systemAnnouncements: announcements };
                        } else if (name === 'NextAdminSystemAnnouncementChannels') {
                            data = { channels: { items: [channel, ...storeChannels] } };
                        } else if (name === 'NextAdminCreateSystemAnnouncement') {
                            const next = {
                                ...input,
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
                            if ('imageAssetId' in input) {
                                next.imageAsset = input.imageAssetId
                                    ? input.imageAssetId === replacementAsset.id
                                        ? replacementAsset
                                        : asset
                                    : null;
                            }
                            blocks = previous
                                ? blocks.map(block => (block.id === next.id ? next : block))
                                : [...blocks, next];
                            if (params.has('persist')) {
                                sessionStorage.setItem('carousel-fixture-blocks', JSON.stringify(blocks));
                            }
                            data = {
                                [previous ? 'updateStorefrontContentBlock' : 'createStorefrontContentBlock']:
                                    next,
                            };
                        } else throw new Error(`Unexpected fixture operation: ${name}`);
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
createRoot(document.getElementById('root')!).render(
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
                            {params.has('services') ? (
                                <BusinessServicesCopyModule />
                            ) : params.has('support') || params.has('announcements') ? (
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
    </React.Fragment>,
);
