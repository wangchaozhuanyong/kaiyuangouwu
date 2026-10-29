import type { ImageTransformPreset } from '@vendure/asset-server-plugin';
import { storefrontResponsiveImagePresets } from '@vendure/storefront-content-plugin';

export const storefrontAssetPresets: ImageTransformPreset[] = [
    ...storefrontResponsiveImagePresets(),
    { name: 'storefront-original-preview', width: 1600, height: 1600, mode: 'resize' },
    { name: 'storefront-placeholder-square-48', width: 48, height: 48, mode: 'crop' },
    { name: 'storefront-placeholder-wide-64', width: 64, height: 64, mode: 'resize' },
    { name: 'storefront-thumbnail-fit-320', width: 320, height: 320, mode: 'resize' },
    // Keep legacy card presets available while older storefront bundles are still cached.
    { name: 'storefront-card-320', width: 320, height: 280, mode: 'crop' },
    { name: 'storefront-card-640', width: 640, height: 560, mode: 'crop' },
    { name: 'storefront-hero-480', width: 480, height: 240, mode: 'crop' },
    { name: 'storefront-hero-960', width: 960, height: 480, mode: 'crop' },
    { name: 'storefront-hero-1440', width: 1440, height: 720, mode: 'crop' },
    { name: 'storefront-hero-1600', width: 1600, height: 800, mode: 'crop' },
];
