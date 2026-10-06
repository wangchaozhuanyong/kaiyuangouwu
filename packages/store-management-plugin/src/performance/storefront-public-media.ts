import {
    mediaDescriptor,
    type MediaDescriptor,
    type StorefrontImageKind,
    type StorefrontPageData,
} from '@vendure/storefront-content-plugin';

/** Shared by public page descriptors and worker preparation; dimensions/quality live in responsive-image. */
export const PUBLIC_MEDIA_USES = {
    logo: ['thumbnail'],
    collection: ['thumbnail', 'icon'],
    productList: ['card', 'thumbnail'],
    productDetail: ['detail', 'thumbnail'],
} as const satisfies Record<string, readonly StorefrontImageKind[]>;

export function publicContentImageKinds(
    type: string,
    slot: 'block' | 'item',
): readonly StorefrontImageKind[] {
    if (type === 'AUTH_LOGIN' || type === 'AUTH_REGISTER') return ['detail'];
    if (type === 'HERO' || type === 'SUPPORT' || type === 'STORY') return ['hero'];
    if (type === 'QUICK_LINKS' || type === 'CORE_CATEGORIES' || type === 'NAVIGATION') {
        return slot === 'item' ? ['icon', 'thumbnail', 'card'] : ['hero'];
    }
    // Managed standalone artwork is a banner; item tiles vary with the published layout.
    return slot === 'block' ? ['hero', 'card'] : ['card', 'thumbnail', 'hero'];
}

type Data = Record<string, unknown>;
const record = (value: unknown): Data =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
const records = (value: unknown): Data[] => (Array.isArray(value) ? value.map(record) : []);

/** Only an explicitly published phone HERO binding can join the store's public media. */
export function publicHeroMobileImage(block: unknown, origin: string): string | undefined {
    const content = record(block);
    if (content.type !== 'HERO' || content.enabled === false) return;
    const source = record(content.settings).mobileImageUrl;
    if (typeof source !== 'string' || !source.trim()) return;
    try {
        const url = new URL(source.trim(), origin);
        const path = decodeURIComponent(url.pathname);
        if (
            url.origin === new URL(origin).origin &&
            !url.username &&
            !url.password &&
            /^\/assets\/(?:preview|source)\//u.test(path) &&
            !path.split('/').includes('..')
        )
            return source.trim();
    } catch {
        /* Invalid or another store's URL never grants anonymous media access. */
    }
}

/** Pure projection of already-authorized page data. Never queries a catalog or follows a URL. */
export function publicPageMedia(
    page: Pick<
        StorefrontPageData,
        'scope' | 'config' | 'content' | 'products' | 'catalog' | 'product' | 'collections' | 'flashSales'
    >,
): MediaDescriptor[] {
    const media = new Map<string, MediaDescriptor>();
    const add = (
        source: unknown,
        kinds: readonly StorefrontImageKind[],
        options: { sizes?: string; width?: number; height?: number } = {},
    ) => {
        if (typeof source !== 'string' || !source.trim()) return;
        for (const kind of kinds) {
            const descriptor = mediaDescriptor(source, kind, options);
            let identity = descriptor.identity;
            try {
                identity = new URL(identity, `https://${page.scope.host}`).toString();
            } catch {
                /* Keep the existing opaque identity. */
            }
            const key = JSON.stringify([
                identity,
                kind,
                descriptor.sizes,
                descriptor.width,
                descriptor.height,
            ]);
            if (!media.has(key)) media.set(key, descriptor);
        }
    };
    const blocks = records(record(page.content).blocks).filter(block => block.enabled !== false);
    // Only an actual homepage HERO is eligible to be the first hero preload candidate.
    const orderedBlocks = [
        ...blocks.filter(block => block.type === 'HERO'),
        ...blocks.filter(block => block.type !== 'HERO'),
    ];
    for (const block of orderedBlocks) {
        const type = typeof block.type === 'string' ? block.type : '';
        add(block.imageUrl, publicContentImageKinds(type, 'block'));
        const mobileImage = publicHeroMobileImage(block, `https://${page.scope.host}`);
        if (mobileImage) {
            const settings = record(block.settings);
            const dimension = (value: unknown) =>
                typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
            add(mobileImage, publicContentImageKinds(type, 'block'), {
                width: dimension(settings.mobileImageWidth),
                height: dimension(settings.mobileImageHeight),
            });
        }
        for (const item of records(block.items)) {
            if (item.enabled !== false) add(item.imageUrl, publicContentImageKinds(type, 'item'));
        }
    }
    const config = record(page.config);
    for (const key of ['logoUrl', 'logoOnLightUrl', 'logoOnDarkUrl']) {
        add(config[key], PUBLIC_MEDIA_USES.logo, { sizes: '36px', width: 36, height: 36 });
    }
    const collection = (item: Data) => {
        add(record(item.featuredAsset).preview, PUBLIC_MEDIA_USES.collection);
        for (const child of records(item.children)) collection(child);
    };
    for (const item of records(page.collections)) collection(item);
    const product = (item: Data, detail: boolean) => {
        const kinds = detail ? PUBLIC_MEDIA_USES.productDetail : PUBLIC_MEDIA_USES.productList;
        add(record(item.featuredAsset).preview, kinds);
        if (detail) for (const asset of records(item.assets)) add(asset.preview, kinds);
        for (const variant of records(item.variants)) {
            add(record(variant.featuredAsset).preview, kinds);
            add(record(record(variant.product).featuredAsset).preview, kinds);
            if (detail) for (const asset of records(variant.assets)) add(asset.preview, kinds);
        }
    };
    for (const item of records(page.products)) product(item, false);
    for (const item of records(record(page.catalog).items)) product(item, false);
    if (page.product) product(record(page.product), true);
    for (const sale of records(page.flashSales)) {
        for (const item of records(sale.items)) add(item.imageUrl, PUBLIC_MEDIA_USES.productList);
    }
    return [...media.values()];
}
