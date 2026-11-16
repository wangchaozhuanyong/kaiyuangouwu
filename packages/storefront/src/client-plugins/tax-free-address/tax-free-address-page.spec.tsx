// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    formatTaxFreeAddress,
    type TaxFreeAddressClaim,
} from '../../../../storefront-content-plugin/src/tax-free-address-contract';

import { historyKey, readAddressHistory, saveAddressHistory } from './browser-history';
import { TaxFreeAddressPage } from './tax-free-address-page';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixtures: Array<{ root: ReturnType<typeof createRoot>; client: QueryClient; node: HTMLElement }> = [];
const now = Date.now();
const writeText = vi.fn<(text: string) => Promise<void>>();
const receipt = (id = '1'): TaxFreeAddressClaim => ({
    requestId: '11111111-1111-4111-8111-111111111111',
    serverNow: new Date(now).toISOString(),
    nextAllowedAt: new Date(now + 300_000).toISOString(),
    address: {
        id,
        country: 'United States',
        line1: '123 Example St',
        city: 'Manchester',
        state: 'New Hampshire',
        postalCode: '03101',
        status: 'used',
        createdAt: new Date(now).toISOString(),
        usedAt: new Date(now).toISOString(),
    },
});
beforeEach(() => {
    localStorage.clear();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(async () => {
    for (const mounted of fixtures.splice(0)) {
        await actOnce(() => mounted.root.unmount());
        mounted.client.clear();
        mounted.node.remove();
    }
    vi.restoreAllMocks();
});
const actOnce = (callback: () => void) =>
    act(() => {
        callback();
        return Promise.resolve();
    });
const flush = async () => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
    });
};
async function fixture(claim?: (id: string) => Promise<TaxFreeAddressClaim>) {
    const node = document.createElement('div');
    document.body.append(node);
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const root = createRoot(node);
    fixtures.push({ node, root, client });
    let cooldown: string | null = null;
    const writes: string[] = [];
    const api = {
        status: vi.fn(() =>
            Promise.resolve({ serverNow: new Date(now).toISOString(), nextAllowedAt: cooldown }),
        ),
        claim: vi.fn((requestId: string) => {
            writes.push(requestId);
            cooldown = receipt().nextAllowedAt;
            return claim ? claim(requestId) : Promise.resolve({ ...receipt(), requestId });
        }),
    };
    const render = async (language: 'zh' | 'en' = 'zh', visible = true) => {
        await actOnce(() =>
            root.render(
                <QueryClientProvider client={client}>
                    {visible && <TaxFreeAddressPage api={api} language={language} onBack={() => undefined} />}
                </QueryClientProvider>,
            ),
        );
        await flush();
    };
    const button = (text: string) => {
        const match = [...node.querySelectorAll('button')].find(
            control => control.textContent?.trim() === text,
        );
        if (!match) throw new Error('Missing test action: ' + text);
        return match;
    };
    await render();
    return { node, client, api, writes, render, button };
}
describe('anonymous address tool with the real root QueryClient', () => {
    it('extracts once, shows countdown, persists local history and copies the exact five-line format', async () => {
        const f = await fixture();
        await actOnce(() => f.button('提取地址').click());
        await flush();
        expect(f.writes).toHaveLength(1);
        expect(f.node.textContent).toContain('下次可提取');
        expect(readAddressHistory('address-tool').records).toHaveLength(1);
        expect(readAddressHistory('other-store').records).toHaveLength(0);
        await actOnce(() => f.button('一键复制').click());
        expect(writeText).toHaveBeenCalledWith(
            '国家（英语）：United States\n地址（英语）：123 Example St\n城市（英语）：Manchester\n州（英语）：New Hampshire\n邮编（英语）：03101',
        );
        expect(f.writes).toHaveLength(1);
        await f.render('en');
        expect(f.node.textContent).toContain('Available in');
        expect(f.writes).toHaveLength(1);
    });
    it('keeps an in-flight write locked through unmount/language switch and saves the late receipt', async () => {
        let resolve!: (result: TaxFreeAddressClaim) => void;
        const f = await fixture(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        await actOnce(() => f.button('提取地址').click());
        await flush();
        await f.render('zh', false);
        await f.render('en');
        expect(f.button('Getting address…').disabled).toBe(true);
        expect(f.writes).toHaveLength(1);
        await actOnce(() => resolve({ ...receipt(), requestId: f.writes[0] }));
        await flush();
        expect(readAddressHistory('address-tool').records).toHaveLength(1);
        expect(f.node.textContent).toContain('123 Example St');
    });
    it('reconciles an uncertain request during cooldown with the same request ID', async () => {
        let attempts = 0;
        const f = await fixture(id => {
            if (++attempts === 1) return Promise.reject(new Error('connection lost after commit'));
            return Promise.resolve({ ...receipt(), requestId: id });
        });
        await actOnce(() => f.button('提取地址').click());
        await flush();
        const retry = f.button('核对原提取请求');
        expect(retry).toBeDefined();
        expect(retry.disabled).toBe(false);
        await actOnce(() => retry.click());
        await flush();
        expect(f.writes).toHaveLength(2);
        expect(new Set(f.writes).size).toBe(1);
        expect(readAddressHistory('address-tool').records).toHaveLength(1);
    });
    it('clear history and clipboard denial do not reset the server cooldown or claim again', async () => {
        const f = await fixture();
        await actOnce(() => f.button('提取地址').click());
        await flush();
        writeText.mockRejectedValueOnce(new Error('denied'));
        await actOnce(() => f.button('一键复制').click());
        expect(f.node.textContent).toContain('复制失败');
        await actOnce(() => f.button('清空记录').click());
        await actOnce(() => f.button('确认清空').click());
        await flush();
        expect(readAddressHistory('address-tool').records).toHaveLength(0);
        expect(f.node.textContent).toContain('下次可提取');
        expect(f.writes).toHaveLength(1);
    });
    it('recovers the original request from root memory when storage writes are denied', async () => {
        let attempts = 0;
        const f = await fixture(id => {
            if (++attempts === 1) return Promise.reject(new Error('connection lost after commit'));
            return Promise.resolve({ ...receipt(), requestId: id });
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        await actOnce(() => f.button('提取地址').click());
        await flush();
        await f.render('zh', false);
        await f.render('en');
        const retry = f.button('Check previous request');
        expect(retry.disabled).toBe(false);
        await actOnce(() => retry.click());
        await flush();
        expect(f.writes).toHaveLength(2);
        expect(new Set(f.writes).size).toBe(1);
        expect(f.node.textContent).toContain('123 Example St');
    });
    it('shows the new result even when browser storage is unavailable, and rejects corrupt history safely', async () => {
        localStorage.setItem(historyKey('address-tool'), '{"broken":true}');
        expect(readAddressHistory('address-tool').unavailable).toBe(true);
        const f = await fixture();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        await actOnce(() => f.button('提取地址').click());
        await flush();
        expect(f.node.textContent).toContain('123 Example St');
        expect(f.node.textContent).toContain('浏览器记录未能完整保存或读取');
        expect(f.writes).toHaveLength(1);
    });
    it('stores at most 1000 receipts, preserves leading zero ZIP codes, and deduplicates receipt replays', () => {
        for (let n = 0; n < 1002; n++) {
            const row = { ...receipt(String(n)), requestId: String(n) };
            saveAddressHistory('bounded', row);
        }
        expect(readAddressHistory('bounded').records).toHaveLength(1000);
        expect(formatTaxFreeAddress(receipt().address)).toContain('邮编（英语）：03101');
        saveAddressHistory('bounded', { ...receipt('last'), requestId: '1001' });
        expect(readAddressHistory('bounded').records).toHaveLength(1000);
    });
});
