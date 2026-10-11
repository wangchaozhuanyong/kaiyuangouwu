// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProductEditor } from './ProductEditorContext';
import { ProductEditorIdentityFields, ProductEditorSidebar } from './ProductEditorSidebar';

const mocks = vi.hoisted(() => ({
    copy: vi.fn(),
    copying: false,
    typeAllowed: false,
    typeLoading: false,
    typeError: undefined as Error | undefined,
    canCreateAsset: true,
}));

vi.mock('./ProductEditorContext', () => ({ useProductEditor: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useMutation: () => [mocks.copy, { loading: mocks.copying }],
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({
        data: { productTypeChangeAllowed: mocks.typeAllowed },
        loading: mocks.typeLoading,
        error: mocks.typeError,
    }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({
        hasAnyPermission: (permissions: string[]) =>
            !permissions.includes('CreateAsset') || mocks.canCreateAsset,
    }),
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('./ProductAiImageDialog', () => ({
    ProductAiImageDialog: ({ onUse }: { onUse: (asset: { id: string; preview: string }) => void }) => (
        <button
            type="button"
            onClick={() => onUse({ id: 'generated-image', preview: '/assets/generated.png' })}
        >
            使用生成图片
        </button>
    ),
}));

const editorFixture = (overrides = {}) => ({
    isCreateMode: false,
    productData: { product: { id: 'product-1', customFields: { pricingMode: 'FIXED' } } },
    productName: '测试商品',
    setProductName: vi.fn(),
    slug: 'test-product',
    setSlug: vi.fn(),
    enabled: true,
    setEnabled: vi.fn(),
    featuredAssetId: 'asset-1',
    setFeaturedAssetId: vi.fn(),
    featuredAssetPreview: '/assets/product.png',
    setFeaturedAssetPreview: vi.fn(),
    setKnownAssets: vi.fn(),
    setIsAssetPickerOpen: vi.fn(),
    setAssetPickerMode: vi.fn(),
    fulfillmentType: 'digital',
    fixedFulfillmentType: undefined,
    setFulfillmentType: vi.fn(),
    navigate: vi.fn(),
    setErrorMessage: vi.fn(),
    dynamicCustomFieldValues: {},
    catalogChannelsData: { activeChannel: { code: 'store-1', displayName: '当前销售店铺' } },
    formErrors: {},
    setFormErrors: vi.fn(),
    isDirty: false,
    saving: false,
    ...overrides,
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.copying = false;
    mocks.typeAllowed = false;
    mocks.typeLoading = false;
    mocks.typeError = undefined;
    mocks.canCreateAsset = true;
    mocks.copy.mockResolvedValue({ data: { copyProductBasicsAsType: { id: 'new-product' } } });
    vi.mocked(useProductEditor).mockReturnValue(editorFixture() as never);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const button = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        candidate =>
            candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
    )!;

describe('ProductEditorSidebar', () => {
    it('keeps media, status, category slot and store together while identity moves to the main panel', () => {
        const html = renderToStaticMarkup(
            <ProductEditorSidebar>
                <section>商品分类摘要</section>
            </ProductEditorSidebar>,
        );
        expect(html).toContain('aria-label="商品固定信息"');
        expect(html).not.toContain('value="测试商品"');
        expect(html).not.toContain('value="test-product"');
        expect(html).toContain('图片编号 #asset-1');
        expect(html).toContain('AI 生成主图');
        expect(html).toContain('商品分类摘要');
        expect(html).toContain('当前销售店铺');
        expect(html).toContain('标价销售');
        expect(html).toContain('aspect-square');
        expect(html).toContain('object-contain');
        expect(html).not.toContain('group-hover');
        expect(html.indexOf('商品状态')).toBeLessThan(html.indexOf('商品分类摘要'));
        expect(html.indexOf('商品分类摘要')).toBeLessThan(html.indexOf('销售店铺'));

        const identityHtml = renderToStaticMarkup(<ProductEditorIdentityFields />);
        expect(identityHtml).toContain('value="测试商品"');
        expect(identityHtml).toContain('value="test-product"');
        expect(identityHtml).toContain('data-admin-field="auto"');
    });

    it('offers upload and selection without rendering a missing image', () => {
        vi.mocked(useProductEditor).mockReturnValue(
            editorFixture({
                isCreateMode: true,
                productData: undefined,
                featuredAssetId: null,
                featuredAssetPreview: null,
            }) as never,
        );
        const html = renderToStaticMarkup(<ProductEditorSidebar />);
        expect(html).toContain('选择商品主图');
        expect(html).toContain('上传商品主图');
        expect(html).not.toContain('alt="商品主图预览"');
        expect(html).toContain('aria-label="商品类型"');
    });

    it('preserves replace, remove, AI asset and enabled draft callbacks', async () => {
        const editor = editorFixture();
        vi.mocked(useProductEditor).mockReturnValue(editor as never);
        await act(async () => root.render(<ProductEditorSidebar />));
        await act(async () => button('更换主图').click());
        expect(editor.setAssetPickerMode).toHaveBeenCalledWith('FEATURED');
        expect(editor.setIsAssetPickerOpen).toHaveBeenCalledWith(true);
        await act(async () => button('移除商品主图').click());
        expect(editor.setFeaturedAssetId).toHaveBeenCalledWith(null);
        expect(editor.setFeaturedAssetPreview).toHaveBeenCalledWith(null);
        await act(async () => button('启用商品').click());
        expect(editor.setEnabled).toHaveBeenCalledWith(false);
        await act(async () => button('AI 生成主图').click());
        await act(async () => button('使用生成图片').click());
        expect(editor.setFeaturedAssetId).toHaveBeenCalledWith('generated-image');
        expect(editor.setFeaturedAssetPreview).toHaveBeenCalledWith('/assets/generated.png');
        expect(editor.setKnownAssets).toHaveBeenCalledOnce();
    });

    it('preserves copy-to-other-type input and navigation', async () => {
        const editor = editorFixture();
        vi.mocked(useProductEditor).mockReturnValue(editor as never);
        await act(async () => root.render(<ProductEditorSidebar />));
        await act(async () => button('复制基础资料创建实物商品').click());
        expect(mocks.copy).toHaveBeenCalledWith({
            variables: { productId: 'product-1', fulfillmentType: 'physical' },
        });
        expect(editor.navigate).toHaveBeenCalledWith('/catalog/products/new-product');
    });

    it('keeps copying disabled for unsaved drafts and media/state controls disabled while saving', async () => {
        vi.mocked(useProductEditor).mockReturnValue(editorFixture({ isDirty: true, saving: true }) as never);
        await act(async () => root.render(<ProductEditorSidebar />));
        for (const label of [
            '复制基础资料创建实物商品',
            '更换主图',
            '移除商品主图',
            '启用商品',
            'AI 生成主图',
        ]) {
            expect(button(label).disabled).toBe(true);
        }
        await act(async () => button('复制基础资料创建实物商品').click());
        expect(mocks.copy).not.toHaveBeenCalled();
    });

    it('keeps type changes locked on an eligibility read failure and preserves asset permissions', () => {
        mocks.typeError = new Error('读取失败');
        mocks.canCreateAsset = false;
        const html = renderToStaticMarkup(<ProductEditorSidebar />);
        expect(html).toContain('类型检查失败，请刷新后重试');
        expect(html).not.toContain('<select');
        expect(html).not.toContain('AI 生成主图');
    });
});
