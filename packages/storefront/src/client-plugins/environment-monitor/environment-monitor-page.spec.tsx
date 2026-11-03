// organize-imports-ignore -- Preserve ESLint type groups.
// @vitest-environment jsdom
import type { BrowserSignals } from './detection';
import type { EnvironmentNetworkReport } from '../../../../storefront-content-plugin/src/environment-monitor-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scoreBrowserSignals } from './detection';
import { EnvironmentMonitorPage, networkView } from './environment-monitor-page';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sampleSignals: BrowserSignals = {
    timezone: 'Asia/Kuala_Lumpur',
    offset: 480,
    languages: ['zh-CN', 'en-US'],
    script: 'Hans',
    locale: 'zh-CN',
    cjkFonts: ['PingFang SC', 'Hiragino Sans GB', 'STHeiti', 'STSong'],
    vendorFonts: [],
    browserToken: '',
    deviceToken: '',
    emoji: 'Apple',
    browser: 'Chrome',
    platform: 'macOS',
};
const report = scoreBrowserSignals(sampleSignals);
const network = {
    provider: 'IPDB',
    ip: '198.51.100.24',
    maskedIp: '198.51.*.*',
    cached: false,
    lookupIssue: null,
    checkedAt: new Date().toISOString(),
    country: 'Malaysia',
    countryCode: 'MY',
    city: 'Kuala Lumpur',
    region: null,
    postalCode: null,
    latitude: 3.139,
    longitude: 101.687,
    geoProvider: 'IPGUIDE',
    timezone: 'Asia/Kuala_Lumpur',
    isp: 'Synthetic ISP',
    asn: '64500',
    connectionType: 'residential',
    fraudScore: 0,
    proxy: false,
    vpn: false,
    tor: false,
};
const mounted: Array<{ root: ReturnType<typeof createRoot>; node: HTMLDivElement; client: QueryClient }> = [];
function fixture() {
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted.push({ root, node, client });
    const api = { request: vi.fn().mockResolvedValue({ environmentNetworkReport: network }) };
    const collect = vi.fn().mockResolvedValue(report);
    const render = (scope = 'store-a:MYR', language: 'zh' | 'en' = 'zh', customerId?: string) =>
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <EnvironmentMonitorPage
                        key={`${scope}:${customerId ?? 'guest'}`}
                        api={api}
                        marketScope={scope}
                        customerId={customerId}
                        language={language}
                        collect={collect}
                        observeNetwork={() => Promise.resolve({ ipv4: null, ipv6: null })}
                        onBack={() => undefined}
                    />
                </QueryClientProvider>,
            ),
        );
    render();
    const flush = () =>
        act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    const click = async (text: string) => {
        await act(() => {
            const b = [...node.querySelectorAll('button')].find(button => button.textContent === text);
            if (!b) return Promise.reject(new Error(`Missing ${text}`));
            b.click();
            return Promise.resolve();
        });
        await flush();
    };
    return { node, root, client, api, collect, render, click, flush };
}
afterEach(() => {
    for (const f of mounted.splice(0)) {
        act(() => f.root.unmount());
        f.node.remove();
        f.client.clear();
    }
    vi.restoreAllMocks();
});
describe('manual live environment page', () => {
    it('labels public IP versions separately and copies the chosen full address without mixing location fields', async () => {
        const f = fixture();
        f.api.request.mockResolvedValueOnce({
            environmentNetworkReport: {
                ...network,
                ipv4: network.ip,
                ipv6: '2001:db8::8',
                addressSource: 'BROWSER',
                postalCode: '00123',
                geoProvider: 'FREEIPAPI',
            },
        });
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        await f.click('开始检测');
        expect(f.node.textContent).toContain('公网 IPv4');
        expect(f.node.textContent).toContain('公网 IPv6');
        expect(f.node.textContent).toContain('00123');
        expect(f.node.textContent).toContain('FreeIPAPI');
        await act(() =>
            Promise.resolve(
                (f.node.querySelector('[aria-label="复制完整 IPv6 地址"]') as HTMLButtonElement).click(),
            ),
        );
        expect(writeText).toHaveBeenCalledWith('2001:db8::8');
        vi.unstubAllGlobals();
    });
    it('starts only on request, always checks the network, shows full IP and twelve scored rows', async () => {
        const f = fixture();
        expect(f.node.querySelector('[role=switch]')).toBeNull();
        expect(f.api.request).not.toHaveBeenCalled();
        expect(f.collect).not.toHaveBeenCalled();
        await f.click('开始检测');
        expect(f.api.request).toHaveBeenCalledTimes(1);
        expect(f.collect).toHaveBeenCalledTimes(1);
        expect(f.node.querySelectorAll('.environment-check-card')).toHaveLength(12);
        expect(f.node.querySelector('.environment-gauge-value')?.textContent).toContain('67');
        expect(f.node.textContent).toContain('198.51.100.24');
        expect(f.node.textContent).not.toContain('198.51.*.*');
        expect(f.api.request.mock.calls[0][1]).toBeUndefined();
        expect(f.api.request.mock.calls[0][0]).not.toContain('zh-CN');
    });
    it('keeps the operation busy until the actual network result arrives and blocks duplicate clicks', async () => {
        const f = fixture();
        let resolve!: (value: unknown) => void;
        f.api.request.mockImplementationOnce(
            () =>
                new Promise(r => {
                    resolve = r;
                }),
        );
        await f.click('开始检测');
        expect(f.node.querySelector('.environment-primary')?.textContent).toBe('正在检测');
        expect(f.node.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('92');
        expect(f.node.textContent).not.toContain('上次环境风险参考分');
        await f.click('正在检测');
        expect(f.api.request).toHaveBeenCalledTimes(1);
        await act(() => Promise.resolve(resolve({ environmentNetworkReport: network })));
        await f.flush();
        expect(f.node.querySelector('.environment-primary')?.textContent).toBe('重新检测');
    });
    it('preserves reports through language switching, invalidation and return navigation, while isolating store and customer', async () => {
        const f = fixture();
        await f.click('开始检测');
        f.render('store-a:MYR', 'en');
        await f.flush();
        expect(f.node.textContent).toContain('67');
        expect(f.node.textContent).toContain('198.51.100.24');
        expect(f.node.textContent).not.toMatch(/\p{Script=Han}/u);
        await act(() => Promise.resolve(f.client.invalidateQueries()));
        f.render('store-b:MYR', 'zh');
        expect(f.node.querySelector('.environment-gauge-value strong')?.textContent).toBe('—');
        f.render('store-a:MYR', 'zh', 'different-customer');
        expect(f.node.querySelector('.environment-gauge-value strong')?.textContent).toBe('—');
        f.render();
        await f.flush();
        expect(f.node.textContent).toContain('67');
        expect(f.collect).toHaveBeenCalledTimes(1);
        expect(f.api.request).toHaveBeenCalledTimes(1);
    });
    it('retains the same scoped report when the unused language cache has expired', async () => {
        const f = fixture();
        await f.click('开始检测');
        const expiredTranslation = f.client
            .getQueryCache()
            .getAll()
            .filter(
                query => query.queryKey.includes('environment-monitor-v2') && query.getObserversCount() === 0,
            );
        expect(expiredTranslation).toHaveLength(1);
        f.client.removeQueries({ queryKey: expiredTranslation[0].queryKey, exact: true });
        f.render('store-a:MYR', 'en');
        await f.flush();
        expect(f.node.querySelector('.environment-gauge-value')?.textContent).toContain('67');
        expect(f.node.textContent).toContain('198.51.100.24');
        expect(f.node.querySelector('.environment-primary')?.textContent).toBe('Check again');
        expect(f.api.request).toHaveBeenCalledTimes(1);
        expect(f.collect).toHaveBeenCalledTimes(1);
    });
    it('preserves busy state across language changes without restarting a paid lookup', async () => {
        const f = fixture();
        let resolve!: (value: unknown) => void;
        f.api.request.mockImplementationOnce(
            () =>
                new Promise(r => {
                    resolve = r;
                }),
        );
        await f.click('开始检测');
        f.render('store-a:MYR', 'en');
        expect(f.node.querySelector('.environment-primary')?.textContent).toBe('Checking');
        await act(() => Promise.resolve(resolve({ environmentNetworkReport: network })));
        await f.flush();
        expect(f.node.querySelector('.environment-primary')?.textContent).toBe('Check again');
        expect(f.api.request).toHaveBeenCalledTimes(1);
    });
    it('keeps local readings on network failure, explains rate limits and retries only the network', async () => {
        const f = fixture();
        f.api.request.mockRejectedValueOnce(new Error('ENVIRONMENT_NETWORK_RATE_LIMIT'));
        await f.click('开始检测');
        expect(f.node.textContent).toContain('67');
        expect(f.node.textContent).toContain('一分钟');
        expect(f.node.querySelector('.environment-network-rows')?.textContent).toContain('zh-CN, en-US');
        await f.click('仅重试网络');
        expect(f.collect).toHaveBeenCalledTimes(1);
        expect(f.api.request).toHaveBeenCalledTimes(2);
        expect(f.node.textContent).toContain('Synthetic ISP');
    });
    it('retains source network types and does not infer a proxy from a data center', () => {
        const view = (connectionType: string | null, proxy: boolean | null = null) =>
            networkView({ ...network, connectionType, proxy } as EnvironmentNetworkReport);
        expect(view('mobile').type).toBe('mobile');
        expect(view('business').type).toBe('business');
        expect(view('datacenter')).toMatchObject({ type: 'datacenter', proxy: null });
        expect(view('vpn')).toMatchObject({ type: 'proxy', proxy: true });
        expect(view(null)).toMatchObject({ type: 'unknown', proxy: null });
    });
    it('copies the full IP and reports clipboard failures without claiming success', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            const f = fixture();
            await f.click('开始检测');
            await act(() =>
                Promise.resolve(
                    (f.node.querySelector('[aria-label="复制完整 IP 地址"]') as HTMLButtonElement).click(),
                ),
            );
            expect(writeText).toHaveBeenCalledWith('198.51.100.24');
            expect(f.node.textContent).toContain('完整 IP 已复制');
            writeText.mockRejectedValueOnce(new Error('denied'));
            await act(() =>
                Promise.resolve(
                    (f.node.querySelector('[aria-label="复制完整 IP 地址"]') as HTMLButtonElement).click(),
                ),
            );
            expect(f.node.textContent).toContain('复制失败');
        } finally {
            if (previous) Object.defineProperty(navigator, 'clipboard', previous);
            else Reflect.deleteProperty(navigator, 'clipboard');
        }
    });
    it('identifies missing network flags and supports a network-only recheck', async () => {
        const f = fixture();
        f.api.request.mockResolvedValueOnce({ environmentNetworkReport: { ...network, proxy: null } });
        await f.click('开始检测');
        expect(f.node.textContent).toContain('暂缺：代理标记');
        await f.click('仅重试网络');
        expect(f.collect).toHaveBeenCalledTimes(1);
        expect(f.api.request).toHaveBeenCalledTimes(2);
        expect(f.node.textContent).not.toContain('暂缺：代理标记');
    });
    it('retains successful current-IP data even when the reputation provider is unavailable', async () => {
        const f = fixture();
        f.api.request.mockResolvedValueOnce({
            environmentNetworkReport: {
                ...network,
                provider: 'REQUEST',
                lookupIssue: 'UNAVAILABLE',
                fraudScore: null,
                connectionType: null,
                proxy: null,
                vpn: null,
                tor: null,
            },
        });
        await f.click('开始检测');
        expect(f.node.textContent).toContain('198.51.100.24');
        expect(f.node.textContent).toContain('网络信誉数据源暂不可用');
        expect(f.node.querySelector('.environment-network-caption')?.textContent).toContain('当前连接');
        expect(f.node.querySelector('.environment-network-score-line')?.textContent).toContain('未知');
        expect(f.node.querySelector('.environment-network-score-line')?.textContent).not.toContain(
            '风险较低',
        );
    });
    it('retries only an unreadable signal and provides a verification path for every row', async () => {
        const f = fixture();
        f.collect.mockResolvedValueOnce(scoreBrowserSignals({ ...sampleSignals, cjkFonts: null }));
        await f.click('开始检测');
        expect(f.node.querySelector('.environment-gauge-value strong')?.textContent).toBe('—');
        expect(f.node.querySelectorAll('.environment-check-card .environment-follow-up')).toHaveLength(12);
        await f.click('重试此项');
        expect(f.collect.mock.calls[1][0].only).toBe('chineseFonts');
        expect(f.node.querySelector('.environment-gauge-value')?.textContent).toContain('67');
        expect(f.api.request).toHaveBeenCalledTimes(1);
    });
    it('shows two actionable tips for the Kuala Lumpur scored timezone and retains no-action only for an unmatched item', async () => {
        const f = fixture();
        await f.click('开始检测');
        const timezone = requiredValue(f.node.querySelector('[data-check-id="timezone"]'));
        expect(timezone.querySelector('summary')?.textContent).toContain('2 项建议');
        expect(timezone.textContent).toContain('+9 分');
        expect(timezone.textContent).toContain('建议优化');
        expect(timezone.textContent).toContain('实际所在地');
        expect(timezone.textContent).toContain('Mac');
        expect(timezone.textContent).not.toContain('无需处理');
        expect(f.node.querySelector('[data-check-id="vendorFonts"] summary')?.textContent).toContain(
            '无需处理',
        );
        for (const card of f.node.querySelectorAll('[data-check-id]')) {
            if (!card.querySelector('.environment-contribution')?.textContent?.match(/\+[1-9]\d* 分/))
                continue;
            expect(card.querySelector('summary')?.textContent).toContain('建议');
            expect(card.textContent).not.toContain('无需处理');
        }
        f.render('store-a:MYR', 'en');
        await f.flush();
        expect(f.node.textContent).not.toMatch(/\p{Script=Han}/u);
        expect(f.node.querySelector('[data-check-id="timezone"] summary')?.textContent).toContain('2 tips');
    });
    it('shows a local collection error without inventing a zero score', async () => {
        const f = fixture();
        f.collect.mockRejectedValueOnce(new Error('restricted'));
        await f.click('开始检测');
        expect(f.node.textContent).toContain('读取失败');
        expect(f.node.querySelector('.environment-gauge-value strong')?.textContent).toBe('—');
        expect(f.node.textContent).toContain('198.51.100.24');
    });
    it('retains browser results during quota exhaustion and can recover with a network-only retry', async () => {
        const f = fixture();
        f.api.request.mockResolvedValueOnce({
            environmentNetworkReport: {
                ...network,
                provider: 'REQUEST',
                lookupIssue: 'DAILY_LIMIT',
                fraudScore: null,
                connectionType: null,
                proxy: null,
            },
        });
        await f.click('开始检测');
        expect(f.node.querySelector('.environment-gauge-value')?.textContent).toContain('67');
        expect(f.node.querySelector('[role="alert"] strong')?.textContent).toBe('今日检测次数额度已用完');
        expect(f.node.textContent).toContain('浏览器本地检测仍可使用');
        expect(f.node.textContent).toContain('无需修改电脑设置或付费解锁');
        expect(f.node.querySelector('.environment-network-score-line')?.textContent).toContain('未知');
        await f.click('仅重试网络');
        expect(f.node.textContent).not.toContain('今日检测次数额度已用完');
        expect(f.node.querySelector('.environment-gauge-value')?.textContent).toContain('67');
        expect(f.collect).toHaveBeenCalledTimes(1);
        expect(f.api.request).toHaveBeenCalledTimes(2);
    });
    it('does not write readings to persistent browser storage', async () => {
        const store = vi.spyOn(Storage.prototype, 'setItem');
        const f = fixture();
        await f.click('开始检测');
        expect(store).not.toHaveBeenCalled();
    });
});

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}
