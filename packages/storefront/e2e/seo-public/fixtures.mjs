/** Synthetic anonymous QA data only; no store, product or editorial claim is real. */
export const fixtureStores = ['synthetic-a', 'synthetic-b'];
export const fixtureLanguages = ['zh_Hans', 'en'];
export const fixtureKinds = ['home', 'product', 'catalog', 'article'];

function block(store, type, title, extra = {}) {
    return {
        id: `${store}-${type.toLowerCase()}`,
        code: `${store}-${type.toLowerCase()}`,
        type,
        enabled: true,
        position: type === 'QUICK_LINKS' ? 0 : 1,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        title,
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [],
        ...extra,
    };
}

export function syntheticPage(store, languageCode, kind, options = {}) {
    if (
        !fixtureStores.includes(store) ||
        !fixtureLanguages.includes(languageCode) ||
        !fixtureKinds.includes(kind)
    )
        throw new Error('Unknown synthetic fixture scope');
    const zh = languageCode === 'zh_Hans';
    const prefix = zh ? 'zh' : 'en';
    const host = options.host ?? `${store}.test`;
    const origin = options.origin ?? `https://${host}`;
    const collectionId = `${store}-collection`;
    const name = zh ? `${store} 合成测试商店` : `${store} Synthetic test store`;
    const body = zh
        ? `${store} 中文合成公开正文，仅用于本地验收。`
        : `${store} English synthetic public body for local acceptance only.`;
    const products = Array.from({ length: 36 }, (_, index) => {
        const id = `${store}-product-${index + 1}`;
        const title = zh ? `${store} 合成商品 ${index + 1}` : `${store} Synthetic product ${index + 1}`;
        const asset = { id: `${id}-image`, preview: '/qa/synthetic-image.svg' };
        return {
            id,
            createdAt: '2026-01-01T00:00:00.000Z',
            name: title,
            slug: id,
            description: `<p>${body} 商品详情 ${index + 1}</p>`,
            featuredAsset: asset,
            assets: [asset],
            collections: [
                {
                    id: collectionId,
                    name: zh ? `${store} 合成分类` : `${store} Synthetic collection`,
                    slug: collectionId,
                    parentId: 'root',
                },
            ],
            variants: [
                {
                    id: `${id}-variant`,
                    name: title,
                    sku: `SYNTHETIC-${index + 1}`,
                    priceWithTax: 2400 + index,
                    currencyCode: 'MYR',
                    stockLevel: 'IN_STOCK',
                    saleableStockLevel: 20,
                    featuredAsset: asset,
                    product: { id, name: title, featuredAsset: asset },
                    customFields: { fulfillmentType: 'physical' },
                },
            ],
            packaging: null,
            customFields: {
                fulfillmentType: 'physical',
                refundPolicy: 'MERCHANT_REVIEW',
                manualDeliverySlaMinutes: 0,
            },
        };
    });
    const collections = [
        {
            id: collectionId,
            name: zh ? `${store} 合成分类` : `${store} Synthetic collection`,
            slug: collectionId,
            description: body,
            position: 0,
            parentId: 'root',
            productVariantCount: 36,
            featuredAsset: products[0].featuredAsset,
            children: [],
        },
    ];
    const blocks = [
        block(store, 'QUICK_LINKS', name, {
            items: [
                {
                    id: `${store}-category-link`,
                    enabled: true,
                    position: 0,
                    imageUrl: '/qa/synthetic-image.svg',
                    targetType: 'CATEGORY',
                    targetValue: collectionId,
                    label: collections[0].name,
                    description: body,
                },
                {
                    id: `${store}-service-link`,
                    enabled: true,
                    position: 1,
                    imageUrl: '/qa/synthetic-image.svg',
                    targetType: 'PAGE',
                    targetValue: 'services',
                    label: zh ? '合成服务' : 'Synthetic services',
                    description: body,
                },
            ],
        }),
        block(
            store,
            'FEATURED_COLLECTION',
            zh ? `${store} 合成精选` : `${store} Synthetic featured products`,
            {
                body,
                settings: { selectedProductIds: [products[0].id, products[1].id], displayCount: 2 },
            },
        ),
    ];
    const request =
        kind === 'home'
            ? { kind: 'home' }
            : kind === 'product'
              ? { kind: 'product', id: products[0].id }
              : kind === 'article'
                ? { kind: 'article', id: `${store}-guide` }
                : {
                      kind: 'catalog',
                      path: '/category',
                      input: {
                          collectionId,
                          sort: 'RECOMMENDED',
                          inStockOnly: false,
                          skip: 12,
                          take: 12,
                      },
                  };
    const route =
        `/${prefix}/` +
        (kind === 'home'
            ? ''
            : kind === 'product'
              ? `product?id=${products[0].id}`
              : kind === 'article'
                ? `guides/${store}-guide`
                : `category?collectionId=${collectionId}&page=2`);
    const requestKey = JSON.stringify(request);
    return {
        schemaVersion: 1,
        version: 'SYNTHETIC-QA-1',
        generatedAt: options.generatedAt ?? Date.now(),
        scope: { host, channelCode: store, languageCode, currencyCode: 'MYR', priceContext: 'public' },
        request,
        requestKey,
        route,
        config: {
            code: store,
            accessMode: 'LIVE',
            defaultCurrencyCode: 'MYR',
            defaultLanguageCode: 'en',
            customFields: {
                storefrontNameZh: `${store} 合成测试商店`,
                storefrontNameEn: `${store} Synthetic test store`,
            },
            availableCountries: [{ code: 'MY', name: 'Malaysia' }],
            description: body,
            tagline: name,
            logoUrl: '/qa/synthetic-image.svg',
        },
        content: {
            blocks,
            flashSales: [],
            systemAnnouncements: [],
            settings: {
                heroAutoplayIntervalSeconds: 5,
                configuredBlockTypes: blocks.map(item => item.type),
                auth: {
                    emailPasswordEnabled: true,
                    emailAutoRegistrationEnabled: false,
                    emailQuickRegistrationEnabled: false,
                    googleEnabled: false,
                    googleClientId: null,
                },
            },
        },
        products: products.slice(0, 12),
        collections,
        flashSales: [],
        visualPreset: { presetId: 'classic' },
        ...(kind === 'product' ? { product: products[0] } : {}),
        ...(kind === 'catalog'
            ? { catalog: { items: products.slice(12, 24), totalItems: products.length } }
            : {}),
        ...(kind === 'article'
            ? {
                  publicContent: {
                      id: `${store}-guide`,
                      title: zh ? `${store} 合成选购指南` : `${store} Synthetic buying guide`,
                      body,
                      summary: zh ? `${store} 合成指南摘要` : `${store} Synthetic guide summary`,
                      authorName: 'Synthetic author',
                      reviewerName: 'Synthetic reviewer',
                      reviewedAt: '2026-01-01T00:00:00.000Z',
                      publishedAt: '2026-01-01T00:00:00.000Z',
                      sources: [
                          {
                              label: 'Synthetic source',
                              url: 'https://example.invalid/qa-source',
                              accessedAt: null,
                          },
                      ],
                      relatedProducts: [{ id: products[0].id, name: products[0].name }],
                  },
              }
            : {}),
        seo: {
            schemaVersion: 1,
            published: true,
            indexable: true,
            host,
            channelCode: store,
            languageCode,
            requestKey,
            title: name,
            description: body,
            canonical: origin + route,
            robots: 'index, follow',
            image: null,
            alternates: ['zh-CN', 'en', 'x-default'].map(language => ({
                language,
                href: origin + route.replace(/^\/(zh|en)\//u, `/${language === 'zh-CN' ? 'zh' : 'en'}/`),
            })),
            structuredData: [
                { '@context': 'https://schema.org', '@type': 'WebPage', name, url: origin + route },
            ],
            reasons: [],
            version: 1,
        },
        media: [],
        failures: [],
    };
}
