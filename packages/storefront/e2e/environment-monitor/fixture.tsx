// organize-imports-ignore -- Preserve ESLint type groups.
import type { ShopApi } from '../../src/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { EnvironmentMonitorPage } from '../../src/client-plugins/environment-monitor/environment-monitor-page';
import { useStorefrontBrandColors } from '../../src/hooks/useStorefrontDocument';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/locale-preferences.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';
import './preview.css';

const params = new URLSearchParams(location.search);
const recovery = params.has('recovery');
const live = params.has('live') || recovery;
let calls = 0;
const api = {
    request: async (query: string, variables?: Record<string, unknown>, signal?: AbortSignal) => {
        document.documentElement.dataset.networkCalls = String(++calls);
        if (live) {
            const response = await fetch(`http://127.0.0.1:${recovery ? 3198 : 3197}/shop-api`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables, testScenario: recovery ? 'recovery' : 'live' }),
                signal,
            });
            const body = await response.json();
            if (!response.ok || body.errors?.length)
                throw new Error(body.errors?.[0]?.message || 'ENVIRONMENT_NETWORK_UNAVAILABLE');
            return body.data;
        }
        await new Promise(resolve => setTimeout(resolve, params.has('slow') ? 1200 : 80));
        signal?.throwIfAborted();
        if (params.has('fail') && calls === 1) throw new Error('ENVIRONMENT_NETWORK_UNAVAILABLE');
        const quota = params.has('quota') && calls === 1;
        const basic = params.has('basic') || quota;
        return {
            environmentNetworkReport: {
                provider: basic ? 'REQUEST' : params.has('ipqs') ? 'IPQS' : 'IPDB',
                checkedAt: new Date().toISOString(),
                ip: params.has('ipv6') ? '2001:db8:1234:5678:90ab:cdef:1234:5678' : '198.51.100.24',
                ipv6: params.has('dual') ? '2001:db8::8' : null,
                maskedIp: '198.51.*.*',
                cached: false,
                lookupIssue: quota ? 'DAILY_LIMIT' : basic ? 'UNAVAILABLE' : null,
                country: basic ? null : 'Malaysia',
                countryCode: basic ? null : 'MY',
                region: basic ? null : 'Kuala Lumpur',
                city: basic ? null : 'Kuala Lumpur',
                timezone: basic ? null : 'Asia/Kuala_Lumpur',
                postalCode: null,
                latitude: basic ? null : 3.139,
                longitude: basic ? null : 101.687,
                geoProvider: basic ? null : 'IPGUIDE',
                connectionType: basic ? null : params.has('high') ? 'datacenter' : 'residential',
                isp: basic ? null : 'Test network provider',
                asn: basic ? null : '64500',
                fraudScore: basic ? null : params.has('high') ? 82 : 0,
                proxy: basic ? null : params.has('high'),
                vpn: basic ? null : false,
                tor: basic ? null : false,
            },
        };
    },
};
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
applyStorefrontVisualPreset(document.documentElement, preset);
function Fixture() {
    const [language, setLanguage] = useState<'zh' | 'en'>(params.has('en') ? 'en' : 'zh');
    useStorefrontBrandColors(undefined, preset);
    useEffect(() => {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        document.title = language === 'zh' ? '环境检测 · 本地验收' : 'Environment check · Local verification';
    }, [language]);
    return (
        <QueryClientProvider client={client}>
            <div className="storefront-app desktop-store-layout">
                <div className="desktop-shell-frame">
                    <div id="storefront-content">
                        <details className="environment-test-notice type-meta">
                            <summary>
                                {recovery
                                    ? language === 'zh'
                                        ? '恢复测试 · 模拟网络'
                                        : 'Recovery test · Synthetic network'
                                    : live
                                      ? language === 'zh'
                                          ? '实机测试 · 浏览器出口'
                                          : 'Local test · Browser egress'
                                      : language === 'zh'
                                        ? '功能测试 · 示例网络'
                                        : 'Functional test · Sample network'}
                            </summary>
                            <p>
                                {recovery
                                    ? language === 'zh'
                                        ? '恢复测试：连接真实本地接口和内存数据库，所有上游响应均为模拟数据；首次代理查询失败，重试后恢复。IP、城市和邮编不代表当前网络。'
                                        : 'Recovery test: real local API and in-memory database with synthetic upstream response' +
                                          's. The first proxy query fails and the retry recovers. IP, city and postcode do not d' +
                                          'escribe this network.'
                                    : live
                                      ? language === 'zh'
                                          ? '实机联调：浏览器直接识别公网 IPv4／IPv6，优先查询 IPv4 的网络与邮编。地址识别失败时显示错误，不使用本机服务出口代替。'
                                          : 'Live local check: observe this browser’s public IPv4/IPv6 and prefer IPv4 for network' +
                                            ' and postal lookups. Failed observation is not replaced with the API server’s egress.'
                                      : language === 'zh'
                                        ? '功能测试：浏览器实时采集，网络返回使用明确的测试数据。'
                                        : 'Functional test: real browser readings with synthetic network responses.'}
                            </p>
                        </details>
                        <EnvironmentMonitorPage
                            api={api as Pick<ShopApi, 'request'>}
                            marketScope="local-environment:MYR"
                            language={language}
                            observeNetwork={
                                recovery
                                    ? () => Promise.resolve({ ipv4: '8.8.8.8', ipv6: null })
                                    : live
                                      ? undefined
                                      : () => Promise.resolve({ ipv4: null, ipv6: null })
                            }
                            onBack={() => history.back()}
                            localeSettings={{
                                currencyCode: 'MYR',
                                currencyCodes: ['MYR'],
                                onToggleLanguage: () => setLanguage(old => (old === 'zh' ? 'en' : 'zh')),
                                onCurrencyChange: () => undefined,
                            }}
                        />
                    </div>
                </div>
            </div>
        </QueryClientProvider>
    );
}
const client = new QueryClient();
const root = createRoot(requiredValue(document.getElementById('root')));
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}
