// organize-imports-ignore -- Keep fixture type imports grouped for ESLint.
import type { ShopApi } from '../../src/api';
import type { Product, ReferralProgram } from '../../src/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    DEFAULT_ARTWORK_POSTER_DESIGN,
    type PosterQrStyle,
} from '../../../common/src/referral-poster-design';
import { SharePosterModal } from '../../src/share-poster-modal';
import '../../src/styles.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

const params = new URLSearchParams(location.search);
const style = (params.get('style') || 'jade') as PosterQrStyle;
const language = params.get('language') === 'en' ? 'en' : 'zh';
applyStorefrontVisualPreset(
    document.documentElement,
    params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic',
);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const picture = document.createElement('canvas');
picture.width = 400;
picture.height = 300;
const ctx = picture.getContext('2d');
if (!ctx) throw new Error('Local fixture requires canvas rendering');
ctx.fillStyle = '#ede6dc';
ctx.fillRect(0, 0, 400, 300);
ctx.fillStyle = '#346358';
ctx.fillRect(90, 70, 220, 135);
const product = {
    id: 'local-product',
    name: language === 'zh' ? '本地商品海报验收' : 'Local product poster check',
    featuredAsset: { id: 'local-product-asset', preview: picture.toDataURL('image/png') },
    assets: [],
    variants: [],
} as unknown as Product;
const program = {
    enabled: false,
    defaultPosterTemplate: 'local-template',
    posterTemplates: [],
    posterTemplateConfigs: [
        {
            id: 'local-template',
            enabled: true,
            design: { ...DEFAULT_ARTWORK_POSTER_DESIGN, qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, style } },
        },
    ],
} as unknown as ReferralProgram;
const api = { referralProgram: () => Promise.resolve(program) } as unknown as ShopApi;
function Fixture() {
    const [open, setOpen] = useState(true);
    const [message, setMessage] = useState('');
    return (
        <QueryClientProvider client={client}>
            <main>
                <button onClick={() => setOpen(true)}>打开商品海报</button>
                <output role="status">{message}</output>
                {open && (
                    <SharePosterModal
                        api={api}
                        market={{
                            code: 'local-product-share',
                            defaultLanguageCode: 'zh_Hans',
                            currencyCode: 'MYR',
                            countryCode: 'MY',
                            locale: 'zh-CN',
                            label: 'Local',
                        }}
                        product={product}
                        storefrontName={language === 'zh' ? '本地测试店铺' : 'Local test shop'}
                        logoUrl={null}
                        language={language}
                        formattedPrice="RM 10.00"
                        onClose={() => setOpen(false)}
                        onNotify={setMessage}
                    />
                )}
            </main>
        </QueryClientProvider>
    );
}
const host = document.getElementById('root');
if (!host) throw new Error('Local fixture root is missing');
createRoot(host).render(<Fixture />);
