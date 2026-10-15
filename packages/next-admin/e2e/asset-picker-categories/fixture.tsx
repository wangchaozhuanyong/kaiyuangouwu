import { ApolloClient, ApolloLink, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { parse, type DocumentNode } from 'graphql';
import React, { useDeferredValue, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminButton } from '../../src/components/AdminControls';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import { usePageSize } from '../../src/hooks/use-page-size';
import '../../src/index.css';
import { ProductAssetPickerModal } from '../../src/pages/Catalog/ProductAssetPickerModal';
import { ProductEditorProvider } from '../../src/pages/Catalog/ProductEditorContext';
import type { AssetItem } from '../../src/pages/Catalog/product-editor-types';
import { useProductEditorData } from '../../src/pages/Catalog/useProductEditorData';
import type { ProductEditorFormState } from '../../src/pages/Catalog/useProductEditorForm';
import { createAdminCache } from '../../src/runtime/admin-cache';
import { assetTagsForCategory, type AssetCategory } from '../../src/utils/asset-categories';

// 377 synthetic records exercise the real picker, production data hook and Apollo.
// No HTTP link, account, production data, upload or mutation is used here.
const images = Array.from({ length: 377 }, (_, index) => {
    const n = index + 1;
    const category = n % 3 === 0 ? 'PRODUCT' : n % 3 === 1 ? 'QUICK_LINK' : 'OTHER';
    const label = category === 'PRODUCT' ? '商品图' : category === 'QUICK_LINK' ? '金刚区' : '其他图片';
    const name = `${label} ${n}.png`;
    return {
        __typename: 'Asset',
        id: String(n),
        name,
        type: 'IMAGE',
        preview: '/assets/fixture-auth.svg',
        source: '/assets/fixture-auth.svg',
        fileSize: 1024,
        mimeType: 'image/png',
        width: 400,
        height: 400,
        tags: assetTagsForCategory([], category).map((value, i) => ({
            __typename: 'Tag',
            id: `${n}-${i}`,
            value,
        })),
        translations: [{ __typename: 'AssetTranslation', id: `${n}-zh`, languageCode: 'zh_Hans', name }],
    };
});
const requests: string[] = [];
const link = new ApolloLink(
    operation =>
        new Observable(observer => {
            const definition = operation.query.definitions.find(item => item.kind === 'OperationDefinition');
            if (definition?.kind === 'OperationDefinition' && definition.operation === 'mutation') {
                observer.error(new Error('This read-only local fixture does not allow writes'));
                return;
            }
            const options = operation.variables.options ?? {};
            const filter = options.filter ?? {};
            let assets = images.filter(
                asset =>
                    (!filter.id?.in || filter.id.in.includes(asset.id)) &&
                    (!filter.name?.contains ||
                        asset.name.toLowerCase().includes(String(filter.name.contains).toLowerCase())),
            );
            if (options.sort?.id !== 'ASC') assets = [...assets].reverse();
            const empty = { items: [], totalItems: 0 };
            const channel = {
                __typename: 'Channel',
                id: 'fixture-store',
                code: 'fixture-store',
                token: 'fixture-public-channel',
                defaultCurrencyCode: 'CNY',
                currencyCode: 'CNY',
                defaultLanguageCode: 'zh_Hans',
                customFields: { storefrontNameZh: '本地验收', storefrontNameEn: 'Local fixture' },
            };
            requests.push(`${operation.operationName} skip=${options.skip ?? 0} take=${options.take ?? 0}`);
            const timer = setTimeout(() => {
                observer.next({
                    data: {
                        assets: {
                            __typename: 'AssetList',
                            totalItems: assets.length,
                            items: assets.slice(
                                options.skip ?? 0,
                                (options.skip ?? 0) + (options.take ?? 100),
                            ),
                        },
                        activeChannel: channel,
                        channels: { items: [channel], totalItems: 1 },
                        collections: empty,
                        facets: empty,
                        productOptionGroups: empty,
                        stockLocations: empty,
                        myStoreCommerceMode: { mode: 'DIGITAL', conflicts: [] },
                    },
                });
                observer.complete();
            }, 40);
            return () => clearTimeout(timer);
        }),
);
const client = new ApolloClient({ cache: createAdminCache(), link });
const emptyProduct: DocumentNode = parse('query EmptyPickerProduct { __typename }');

export function Fixture() {
    const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(true);
    const [assetCategory, setAssetCategory] = useState<AssetCategory>('ALL');
    const [assetSearch, setAssetSearch] = useState('');
    const [assetPage, setAssetPage] = useState(0);
    const [assetPageSize, setAssetPageSize] = usePageSize(setAssetPage);
    const [featuredAssetId, setFeaturedAssetId] = useState<string | null>(null);
    const [, setFeaturedAssetPreview] = useState<string | null>(null);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [, setKnownAssets] = useState<Record<string, AssetItem>>({});
    const deferredAssetSearch = useDeferredValue(assetSearch.trim());
    const data = useProductEditorData({
        productId: undefined,
        isCreateMode: true,
        productDetailDocument: emptyProduct,
        facetPage: 0,
        facetPageSize: 20,
        deferredFacetSearch: '',
        assetPage,
        assetPageSize,
        deferredAssetSearch,
        assetCategory,
        optionGroupPage: 0,
        optionGroupPageSize: 20,
        deferredOptionGroupSearch: '',
        isAssetPickerOpen,
        setErrorMessage: () => undefined,
    });
    const state = {
        ...data,
        isAssetPickerOpen,
        setIsAssetPickerOpen,
        assetPickerMode: 'GALLERY',
        assetCategory,
        setAssetCategory,
        assetSearch,
        setAssetSearch,
        assetPage,
        setAssetPage,
        assetPageSize,
        setAssetPageSize,
        featuredAssetId,
        setFeaturedAssetId,
        setFeaturedAssetPreview,
        selectedAssetIds,
        setSelectedAssetIds,
        setKnownAssets,
    } as unknown as ProductEditorFormState;
    return (
        <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
            <p>本地合成素材 · 共377条 · 不连接生产服务</p>
            <AdminButton onClick={() => setIsAssetPickerOpen(true)}>打开素材选择器</AdminButton>
            <output aria-label="选中素材">已选 {selectedAssetIds.length} 张</output>
            <pre aria-label="本地读取记录">{requests.slice(-12).join('\n')}</pre>
            <ProductEditorProvider value={state}>
                <ProductAssetPickerModal />
            </ProductEditorProvider>
        </main>
    );
}
createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <AdminPermissionsProvider permissions={['ReadAsset']}>
            {React.createElement(Fixture)}
        </AdminPermissionsProvider>
    </ApolloProvider>,
);
