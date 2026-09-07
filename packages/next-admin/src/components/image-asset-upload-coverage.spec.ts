import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const imageSelectionSurfaces = [
    '../pages/Catalog/ProductBasicTab.tsx',
    '../pages/Catalog/ProductAssetPickerModal.tsx',
    '../pages/Catalog/CategoryImageField.tsx',
    '../pages/Settings/StoreBrandAssets.tsx',
    '../pages/Settings/BrandAssetPickerDialog.tsx',
    '../pages/Storefront/storefront-asset-picker.tsx',
    '../pages/Marketing/ReferralDialogs.tsx',
];

describe('image selection upload coverage', () => {
    it.each(imageSelectionSurfaces)('%s exposes the shared direct-upload action', relativePath => {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
        expect(source).toContain('<ImageAssetUploadButton');
    });
});
