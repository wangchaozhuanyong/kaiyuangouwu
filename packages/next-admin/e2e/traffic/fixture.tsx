import { ApolloProvider } from '@apollo/client/react';
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ShopApi } from '../../../storefront/src/api';
import { useStorefrontTraffic } from '../../../storefront/src/hooks/useStorefrontTraffic';
import { StorefrontTrafficPreference } from '../../../storefront/src/storefront-ui/storefront-traffic-preference';
import { client } from '../../src/apollo';
import '../../src/index.css';
import { StorefrontTrafficPanel } from '../../src/pages/Dashboard/StorefrontTrafficPanel';

export function StorefrontFixture() {
    const [route, setRoute] = useState(() => new URL(location.href).searchParams.get('route') ?? '/');
    const [, rerender] = useState(0);
    const api = useMemo(
        () =>
            new ShopApi({
                code: 'cn-mainland',
                defaultLanguageCode: 'zh_Hans',
                currencyCode: 'USD',
                countryCode: 'CN',
                locale: 'zh-CN',
                label: '隔离测试店铺',
            }),
        [],
    );
    useStorefrontTraffic({ api, channel: 'cn-mainland', location: route, customerId: null, enabled: true });
    function navigate(value: string) {
        const url = new URL(location.href);
        url.searchParams.set('route', value);
        history.pushState({}, '', url);
        setRoute(value);
    }
    return (
        <main className="p-6">
            <h1 className="text-lg font-bold">采集联调测试页</h1>
            <p className="my-4">仅连接临时测试数据库，不代表线上数据。当前页面：{route}</p>
            <StorefrontTrafficPreference language="zh" />
            <div className="flex gap-4">
                <button onClick={() => navigate('/product/one')}>打开商品页</button>
                <button onClick={() => navigate('/')}>返回首页</button>
                <button onClick={() => rerender(value => value + 1)}>仅重渲染</button>
            </div>
        </main>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        {new URL(location.href).searchParams.get('mode') === 'shop' ? (
            <StorefrontFixture />
        ) : (
            <ApolloProvider client={client}>
                <main className="mx-auto max-w-4xl p-4 sm:p-8">
                    <p className="mb-4 text-xs text-slate-500">
                        隔离联调 · 以下为测试浏览器产生的数据，非线上数据
                    </p>
                    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <h1 className="mb-4 text-sm font-bold text-slate-900">网站访问统计</h1>
                        <StorefrontTrafficPanel />
                    </section>
                </main>
            </ApolloProvider>
        )}
    </StrictMode>,
);
