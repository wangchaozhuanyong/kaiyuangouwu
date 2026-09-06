import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { StorefrontModule } from '../../src/pages/Storefront/StorefrontModule';
import { newContentBlock } from '../../src/pages/Storefront/storefront-content-utils';

// Isolated browser fixture. No HTTP link, account, or store data is used.
const params = new URLSearchParams(location.search);
const asset = {
    __typename: 'Asset',
    id: 'fixture-asset',
    name: '轮播测试素材',
    type: 'IMAGE',
    mimeType: 'image/svg+xml',
    preview: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480"><rect width="960" height="480" fill="#bccbb5"/><rect x="540" y="80" width="250" height="330" rx="24" fill="#eef1e4"/><circle cx="180" cy="160" r="70" fill="#e8c38e"/><text x="90" y="340" font-size="32" fill="#223128">Carousel test image</text></svg>')}`,
    source: '',
};
asset.source = '/assets/fixture-carousel.svg';
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
let interval = 6;
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
let revision = 0;
const operations: Array<{ name: string; variables: unknown }> = [];
const faults = { read: params.has('read-error'), write: false, delete: false, delayMs: 80 };
Object.assign(window, { carouselFixture: { operations, faults, state: () => ({ blocks, interval }) } });
const settings = () => ({
    __typename: 'StorefrontContentSettings',
    heroAutoplayIntervalSeconds: interval,
    configuredBlockTypes: [...new Set(blocks.map(block => block.type))],
});
const channel = {
    __typename: 'Channel',
    id: 'fixture',
    code: '轮播测试店铺',
    token: 'fixture',
    defaultLanguageCode: 'zh_Hans',
    availableLanguageCodes: ['zh_Hans', 'en'],
};
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
                                    presetId: 'classic',
                                    revision: 'default',
                                },
                            };
                        } else if (name === 'NextAdminStorefrontEditorOptions') {
                            data = { products: { items: [], totalItems: 0 } };
                        } else if (name === 'GetAssets') {
                            data = { assets: { items: [asset], totalItems: 1 } };
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
                            if ('imageAssetId' in input) next.imageAsset = input.imageAssetId ? asset : null;
                            blocks = previous
                                ? blocks.map(block => (block.id === next.id ? next : block))
                                : [...blocks, next];
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
                <AdminPermissionsContext.Provider
                    value={{
                        permissions: new URLSearchParams(location.search).has('readonly')
                            ? ['ReadStorefrontContent']
                            : ['SuperAdmin'],
                        hasAnyPermission: permissions =>
                            !new URLSearchParams(location.search).has('readonly') ||
                            permissions.includes('ReadStorefrontContent'),
                    }}
                >
                    <div className="bg-slate-900 px-4 py-2 text-xs text-white">
                        本地轮播管理验收 · 示例数据
                    </div>
                    <div style={{ height: 'calc(100dvh - 32px)' }}>
                        <StorefrontModule />
                    </div>
                </AdminPermissionsContext.Provider>
            </ApolloProvider>
        </FeatureHelpProvider>
    </React.Fragment>,
);
