// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readBrowserNetworkAddresses } from './browser-network-addresses';
afterEach(() => vi.unstubAllGlobals());
describe('browser egress observation', () => {
    it('observes IPv4 and IPv6 separately from fixed endpoints without cookies or referrer', async () => {
        const fetcher = vi
            .fn()
            .mockImplementation((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({ ip: url.includes('api64.') ? '2001:4860:4860::8888' : '8.8.8.8' }),
                    ),
                ),
            );
        vi.stubGlobal('fetch', fetcher);
        expect(await readBrowserNetworkAddresses()).toEqual({
            ipv4: '8.8.8.8',
            ipv6: '2001:4860:4860::8888',
        });
        expect(fetcher.mock.calls.map(call => call[0])).toEqual([
            'https://api.ipify.org?format=json',
            'https://api64.ipify.org?format=json',
        ]);
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            redirect: 'error',
        });
    });
    it('retains IPv6 when IPv4 fails, and never invents a second address on IPv4-only networks', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation((url: string) => {
                if (!url.includes('api64.')) return Promise.reject(new Error('IPv4 unavailable'));
                return Promise.resolve(new Response(JSON.stringify({ ip: '2001:4860:4860::8888' })));
            }),
        );
        expect(await readBrowserNetworkAddresses()).toEqual({ ipv4: null, ipv6: '2001:4860:4860::8888' });
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ip: '8.8.8.8' })))),
        );
        expect(await readBrowserNetworkAddresses()).toEqual({ ipv4: '8.8.8.8', ipv6: null });
    });
    it('rejects malformed payloads and allows the trusted same-origin connection fallback', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ip: '999.8.8.8' })))),
        );
        expect(await readBrowserNetworkAddresses()).toEqual({ ipv4: null, ipv6: null });
    });
    it('honors cancellation rather than starting a fallback lookup after leaving', async () => {
        const controller = new AbortController();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockImplementation((_url, init) =>
                    Promise.resolve(
                        new Promise((_resolve, reject) =>
                            init.signal.addEventListener('abort', () =>
                                reject(new DOMException('Cancelled', 'AbortError')),
                            ),
                        ),
                    ),
                ),
        );
        const result = readBrowserNetworkAddresses(controller.signal);
        controller.abort();
        await expect(result).rejects.toThrow();
    });
});
