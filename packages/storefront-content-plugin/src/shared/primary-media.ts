import { STOREFRONT_CLIENT_PLUGINS_CODE } from '../client-plugin-manifest';

import { authOriginalImageUrl, primaryAuthVisualContent } from './auth-visual-utils';
import { storefrontNavigationCollections, type PublicNavigationCollection } from './public-page-data';
import { STOREFRONT_IMAGE_SIZES, type StorefrontImageKind } from './responsive-image';

export type PrimaryStorefrontMediaRoute =
    'home' | 'services' | 'support' | 'login' | 'register' | 'forgot-password' | 'catalog' | 'product';
export interface PrimaryStorefrontMediaCandidate {
    source: string;
    kind?: StorefrontImageKind;
    sizes?: string;
    media?: string;
}
interface Block {
    type?: string;
    code?: string;
    enabled?: boolean;
    imageUrl?: string | null;
    settings?: Record<string, unknown> | null;
}
interface ProductMedia {
    featuredAsset?: { preview?: string | null } | null;
    variants?: Array<{ featuredAsset?: { preview?: string | null } | null }>;
}
export interface PrimaryStorefrontMediaInput {
    route: PrimaryStorefrontMediaRoute;
    blocks?: readonly Block[];
    product?: ProductMedia | null;
    catalogItems?: readonly ProductMedia[];
    collections?: readonly PublicNavigationCollection[];
    primaryCollectionId?: string;
    catalogPath?: '/category' | '/search';
}
const source = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export { primaryAuthVisualContent } from './auth-visual-utils';

/** Pure selection of the image the existing layout actually displays; never fetches route data. */
export function primaryStorefrontMedia(
    input: PrimaryStorefrontMediaInput,
): PrimaryStorefrontMediaCandidate[] {
    const blocks = input.blocks?.filter(block => block.enabled !== false) ?? [];
    if (input.route === 'home' || input.route === 'services') {
        const home = input.route === 'home';
        const block = blocks.find(item =>
            home
                ? item.type === 'HERO' && Boolean(source(item.imageUrl))
                : item.type === 'CLIENT_PLUGINS' && item.code === STOREFRONT_CLIENT_PLUGINS_CODE,
        );
        if (!block) return [];
        const desktop = source(block.imageUrl);
        const phone =
            !home && block.settings?.businessServicesHeroLayout === 'shared-banner'
                ? desktop
                : source(block.settings?.mobileImageUrl) || desktop;
        const phoneWidth = home ? 767 : 1023;
        if (phone && phone !== desktop)
            return [
                { source: phone, kind: 'hero', media: `(max-width: ${phoneWidth}px)` },
                ...(desktop
                    ? [{ source: desktop, kind: 'hero' as const, media: `(min-width: ${phoneWidth + 1}px)` }]
                    : []),
            ];
        return desktop ? [{ source: desktop, kind: 'hero' }] : [];
    }
    if (input.route === 'support') {
        const image = source(blocks.find(block => block.type === 'SUPPORT')?.imageUrl);
        return image ? [{ source: image, kind: 'hero', media: '(min-width: 1024px)' }] : [];
    }
    if (input.route === 'login' || input.route === 'register' || input.route === 'forgot-password') {
        const block = primaryAuthVisualContent(blocks, input.route === 'register' ? 'register' : 'login');
        const image = source(block?.imageUrl);
        return image
            ? [
                  {
                      source: authOriginalImageUrl(image),
                      kind: 'detail',
                      sizes: '(min-width: 1024px) 640px, 1px',
                      media: '(min-width: 1024px)',
                  },
              ]
            : [];
    }
    const product = input.route === 'product' ? input.product : input.catalogItems?.[0];
    const productImage =
        source(product?.featuredAsset?.preview) ||
        source(
            product?.variants?.find(variant => source(variant.featuredAsset?.preview))?.featuredAsset
                ?.preview,
        );
    if (!productImage) return [];
    if (input.route === 'product') return [{ source: productImage, kind: 'detail' }];
    const navigation = storefrontNavigationCollections([...(input.collections ?? [])]);
    const primary =
        input.primaryCollectionId !== 'all'
            ? navigation.find(item => item.id === input.primaryCollectionId)
            : undefined;
    const hasSidebar = input.catalogPath !== '/search' && (primary?.children?.length ?? 0) > 0;
    return [
        {
            source: productImage,
            kind: 'card',
            sizes: hasSidebar ? STOREFRONT_IMAGE_SIZES.categorySidebarRow : STOREFRONT_IMAGE_SIZES.productRow,
            media: '(max-width: 1023px)',
        },
        {
            source: productImage,
            kind: 'card',
            sizes: STOREFRONT_IMAGE_SIZES.desktopCatalogCard,
            media: '(min-width: 1024px)',
        },
    ];
}
