import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useProductEditor } from './ProductEditorContext';
import { ProductEditorSidebar } from './ProductEditorSidebar';

vi.mock('./ProductEditorContext', () => ({
    useProductEditor: vi.fn(),
}));

vi.mock('../../components/FeatureHelp', () => ({
    FeatureHelpButton: () => null,
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
        expect(html).toContain('切换右侧步骤时保持不变');
        expect(html).toContain('value="测试商品"');
        expect(html).toContain('value="test-product"');
        expect(html).toContain('Asset #asset-1');
        expect(html).toContain('待保存');
        expect(html).toContain('虚拟商品');
    });
});
