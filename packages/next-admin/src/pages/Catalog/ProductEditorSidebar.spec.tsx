import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useProductEditor } from './ProductEditorContext';
import { ProductEditorSidebar } from './ProductEditorSidebar';

vi.mock('./ProductEditorContext', () => ({
    useProductEditor: vi.fn(),
}));

vi.mock('../../components/FeatureHelp', () => ({
    FeatureHelpButton: ({ description }: { description?: string }) => (
        <span data-help-description={description} />
    ),
}));

vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ permissions: ['SuperAdmin'], hasAnyPermission: () => true }),
}));

describe('ProductEditorSidebar', () => {
    it('keeps product identity and cross-tab summaries in one fixed panel', () => {
        vi.mocked(useProductEditor).mockReturnValue({
            isCreateMode: true,
            productData: undefined,
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
            setIsAssetPickerOpen: vi.fn(),
            setAssetPickerMode: vi.fn(),
            effectiveFulfillmentType: 'digital',
            variants: [{ id: 'variant-1' }, { id: 'variant-2' }],
            selectedFacetValueIds: ['facet-1'],
            selectedCollectionIds: ['collection-1', 'collection-2'],
            formErrors: {},
            setFormErrors: vi.fn(),
            isDirty: true,
            saving: false,
        } as never);

        const html = renderToStaticMarkup(<ProductEditorSidebar />);

        expect(html).toContain('aria-label="商品固定信息"');
        expect(html).not.toContain('切换右侧步骤时保持不变');
        expect(html).toContain('value="测试商品"');
        expect(html).toContain('value="test-product"');
        expect(html).toContain('图片编号 #asset-1');
        expect(html).toContain('AI 生成主图');
        expect(html).not.toContain('商品总览');
        expect(html).not.toContain('SKU');
        expect(html).toContain('aspect-square');
        expect(html).toContain('object-contain');
        expect(html).not.toContain('aspect-[4/3]');
    });

    it('offers upload and selection without rendering a missing image', () => {
        vi.mocked(useProductEditor).mockReturnValue({
            isCreateMode: true,
            productData: undefined,
            productName: '',
            setProductName: vi.fn(),
            slug: '',
            setSlug: vi.fn(),
            enabled: true,
            setEnabled: vi.fn(),
            featuredAssetId: null,
            setFeaturedAssetId: vi.fn(),
            featuredAssetPreview: null,
            setFeaturedAssetPreview: vi.fn(),
            setIsAssetPickerOpen: vi.fn(),
            setAssetPickerMode: vi.fn(),
            effectiveFulfillmentType: 'digital',
            variants: [],
            selectedFacetValueIds: [],
            selectedCollectionIds: [],
            formErrors: {},
            setFormErrors: vi.fn(),
            isDirty: false,
            saving: false,
        } as never);

        const html = renderToStaticMarkup(<ProductEditorSidebar />);

        expect(html).toContain('选择商品主图');
        expect(html).toContain('上传商品主图');
        expect(html).not.toContain('alt="商品主图预览"');
    });
});
