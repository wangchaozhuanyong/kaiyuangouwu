import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActiveCustomer, MarketConfig } from '../../src/types';

import { ShopApi } from '../../src/api';
import { AiImageStudioPage } from '../../src/pages/ai-image-studio-page';
import '../../src/styles.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/visual-presets.css';

// Only the surrounding shell is a fixture. Authentication and all studio methods use ShopApi.
const bootstrap = (window as unknown as { studioBootstrap: { email: string; password: string } })
    .studioBootstrap;
const market: MarketConfig = {
    code: 'local-e2e',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'USD',
    countryCode: 'US',
    locale: 'zh-CN',
    label: '本地验收',
};
const api = new ShopApi(market);
function Harness({ customer }: { customer: ActiveCustomer }) {
    const [notice, setNotice] = useState('');
    return (
        <>
            <div style={{ padding: 8, background: '#fff7df', fontSize: 12 }}>
                本地验收 · 真实 API / MySQL / 私有存储 · 模拟供应商
            </div>
            <div role="status">{notice}</div>
            <AiImageStudioPage
                api={api}
                customer={customer}
                market={market}
                displayCurrencyCode="USD"
                language="zh"
                onBack={() => undefined}
                onSignIn={() => undefined}
                onNotify={setNotice}
            />
        </>
    );
}
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Fixture root is missing');
const root = createRoot(rootElement);
void (async () => {
    await api.login(bootstrap.email, bootstrap.password);
    bootstrap.password = '';
    // The isolated image backend omits checkout extensions used by the full account query.
    // Read identity through the same authenticated transport without unrelated order fields.
    const transport = api as unknown as { request<T>(query: string): Promise<T> };
    const { activeCustomer: customer } = await transport.request<{ activeCustomer: ActiveCustomer | null }>(
        'query BrowserImageCustomer { activeCustomer { id firstName lastName emailAddress } }',
    );
    if (!customer) throw new Error('Local browser customer did not authenticate');
    root.render(<Harness customer={customer} />);
})().catch(error => root.render(<div role="alert">{String(error)}</div>));
