/* oxlint-disable react/only-export-components -- Browser fixture mounts directly into its test page. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { ProductAssetPickerModal } from '../../src/pages/Catalog/ProductAssetPickerModal';
import { ProductBasicTab } from '../../src/pages/Catalog/ProductBasicTab';
import { ProductEditorProvider } from '../../src/pages/Catalog/ProductEditorContext';
import type { AssetItem } from '../../src/pages/Catalog/product-editor-types';
import type { ProductEditorFormState } from '../../src/pages/Catalog/useProductEditorForm';

function ImageUploadFixture() {
    const [featuredAssetId, setFeaturedAssetId] = useState<string | null>(null);
    const [featuredAssetPreview, setFeaturedAssetPreview] = useState<string | null>(null);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [knownAssets, setKnownAssets] = useState<Record<string, AssetItem>>({});
    const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
    const [assetPickerMode, setAssetPickerMode] = useState<'FEATURED' | 'GALLERY'>('FEATURED');
    const [assetSearch, setAssetSearch] = useState('');
    const [assetPage, setAssetPage] = useState(0);
    const [formErrors, setFormErrors] = useState<Record<string, string | undefined>>({});

    const value = {
        isCreateMode: true,
        productName: '浏览器验收商品',
        setProductName: () => undefined,
        slug: 'browser-fixture-product',
        setSlug: () => undefined,
        enabled: true,
        setEnabled: () => undefined,
        description: '用于验收图片直接上传和自动选中。',
        setDescription: () => undefined,
        fulfillmentType: 'physical',
        setFulfillmentType: () => undefined,
        refundPolicy: 'MERCHANT_REVIEW',
        setRefundPolicy: () => undefined,
        manualDeliverySlaMinutes: 60,
        setManualDeliverySlaMinutes: () => undefined,
        dynamicCustomFieldValues: {},
        setDynamicCustomFieldValues: () => undefined,
        productExtensionFields: [],
        featuredAssetId,
        setFeaturedAssetId,
        featuredAssetPreview,
        setFeaturedAssetPreview,
        selectedAssetIds,
        setSelectedAssetIds,
        isAssetPickerOpen,
        setIsAssetPickerOpen,
        assetPickerMode,
        setAssetPickerMode,
        assetSearch,
        setAssetSearch,
        assetPage,
        assetPageSize: 20,
        setAssetPageSize: () => undefined,
        setAssetPage,
        knownAssets,
        setKnownAssets,
        assetsData: {
            assets: {
                items: Object.values(knownAssets),
                totalItems: Object.keys(knownAssets).length,
            },
        },
        assetsLoading: false,
        assetsError: undefined,
        refetchAssets: async () => undefined,
        formErrors,
        setFormErrors,
        commerceMode: 'HYBRID',
        productData: undefined,
        fixedFulfillmentType: null,
        effectiveFulfillmentType: 'physical',
        saving: false,
    } as unknown as ProductEditorFormState;

    return (
        <AdminPermissionsContext.Provider
            value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
        >
            <FeatureHelpProvider>
                <main className="min-h-screen bg-slate-50 p-5 sm:p-8">
                    <ProductEditorProvider value={value}>
                        <ProductBasicTab />
                        <ProductAssetPickerModal />
                    </ProductEditorProvider>
                </main>
            </FeatureHelpProvider>
        </AdminPermissionsContext.Provider>
    );
}

createRoot(document.getElementById('root')!).render(<ImageUploadFixture />);
