// organize-imports-ignore -- Match the production stylesheet cascade.
import type { MarketConfig, Product } from '../../src/types';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { ProductCard } from '../../src/components/common/product-card';
import { ProductRow } from '../../src/components/common/product-row';

import '../../src/storefront-styles';
import '../../src/commerce-styles';
import { fixtureData } from './fixtures.mjs';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const palette = resolveStorefrontSemanticPalette(preset, {});
document.documentElement.dataset.storefrontPreset = preset;
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);
const market: MarketConfig = {
    code: 'product-row-local-sample',
    currencyCode: 'MYR',
    countryCode: 'MY',
    defaultLanguageCode: language === 'zh' ? 'zh_Hans' : 'en',
    locale: language === 'zh' ? 'zh-CN' : 'en-MY',
    label: 'Local sample',
};
const sample = structuredClone(fixtureData(preset).products.items[0]) as Product;
const products = ['normal', 'warranty', 'large', 'quote', 'sold-out'].map((kind, i) => ({
    ...sample,
    id: `local-row-${i}`,
    name: language === 'zh' ? '商品布局样例' : 'Local product layout sample',
    description:
        language === 'zh'
            ? '<p>商品介绍与服务说明，仅供本地布局验收。</p>'
            : '<p>Product information and service details for local layout review.</p>',
    warrantyDuration: kind === 'warranty' ? (language === 'zh' ? '90天' : '90 days') : null,
    featuredAsset: { id: 'local-picture', preview: '/storefront/categories/category-desk-setup.jpg' },
    customFields: { ...sample.customFields, pricingMode: kind === 'quote' ? 'QUOTE_ONLY' : 'PRICE' },
    variants: sample.variants.map(variant => ({
        ...variant,
        priceWithTax: kind === 'large' ? 123456789 : 2800,
        saleableStockLevel: kind === 'sold-out' ? 0 : 100,
        stockLevel: kind === 'sold-out' ? 'OUT_OF_STOCK' : 'IN_STOCK',
    })),
})) as Product[];
function Fixture() {
    return (
        <main className="storefront-app" style={{ padding: 16 }}>
            <p className="type-helper">
                {language === 'zh'
                    ? '共享商品组件 · 本地样例 · 未发布'
                    : 'Shared product components · Local samples · Not published'}
            </p>
            <section aria-label="Product rows" className="product-list" style={{ display: 'grid', gap: 12 }}>
                {products.map((product, index) => (
                    <div key={product.id} data-sample={index}>
                        <ProductRow
                            product={product}
                            market={market}
                            locale={market.locale}
                            language={language}
                            onOpen={() => undefined}
                        />
                    </div>
                ))}
            </section>
            <section aria-label="Compact product row" style={{ marginTop: 16 }}>
                <ProductRow
                    product={products[0]}
                    layout="compact"
                    showDescription={false}
                    market={market}
                    locale={market.locale}
                    language={language}
                    onOpen={() => undefined}
                />
            </section>
            <section aria-label="Grid product card" style={{ marginTop: 16, maxWidth: 240 }}>
                <ProductCard
                    product={products[0]}
                    market={market}
                    locale={market.locale}
                    language={language}
                    onOpen={() => undefined}
                />
            </section>
        </main>
    );
}
const rootRoute = createRootRoute({ component: Fixture });
const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const host = document.getElementById('root');
if (!host) throw new Error('Missing product row fixture root');
createRoot(host).render(<RouterProvider router={router} />);
