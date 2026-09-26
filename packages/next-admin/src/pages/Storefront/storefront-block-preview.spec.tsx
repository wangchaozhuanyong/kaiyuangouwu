import { FeatureHelpProvider } from '../../components/FeatureHelp';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockPreview } from './storefront-block-preview';
import { newContentBlock } from './storefront-content-utils';
import { contentPublicationLabels, contentPublicationStatus } from './storefront-publication';

const state = vi.hoisted(() => ({
    token: 'fixture',
    data: { activeChannel: { id: 'store', code: 'shop', token: 'fixture' } },
}));
vi.mock('@apollo/client/react', () => ({ useQuery: () => ({ data: state.data }) }));
vi.mock('../../apollo', () => ({ ADMIN_API_URL: '/admin-api', getActiveChannelToken: () => state.token }));
vi.stubGlobal(
    'ResizeObserver',
    class {
        observe() {}
        disconnect() {}
    },
);
const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.restoreAllMocks();
    state.token = 'fixture';
});

async function renderPreview() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
        root.unmount();
        host.remove();
    });
    const block = newContentBlock('HERO', 0, '首页横幅');
    block.enabled = true;
    block.imageAsset = {
        id: 'hero',
        name: 'hero',
        mimeType: 'image/png',
        preview: '/assets/hero.png',
        source: '/assets/hero-original.png',
        width: 1600,
        height: 520,
    };
    const fetchMock = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(
            new Response(
                '<html><head><link rel="stylesheet" href="/dashboard/assets/client.css"></head><body><div id="root"></div><script type="module" src="/dashboard/assets/storefrontPreview-fixture.js"></script></body></html>',
            ),
        );
    const render = async () => {
        await act(async () => {
            root.render(
                <FeatureHelpProvider>
                    <BlockPreview block={{ ...block }} language="zh_Hans" />
                </FeatureHelpProvider>,
            );
        });
    };
    await render();
    return { host, block, render, fetchMock };
}

describe('real client decoration preview', () => {
    it('loads the isolated built client entry, preserves the CSS and uses an actual viewport', async () => {
        const { host, fetchMock } = await renderPreview();
        const frame = host.querySelector('iframe')!;
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('storefront-preview.html'),
            expect.anything(),
        );
        expect(frame.srcdoc).toContain('/dashboard/assets/client.css');
        expect(frame.srcdoc).toContain('/dashboard/assets/storefrontPreview-fixture.js');
        expect(frame.srcdoc).not.toContain('hero-editor-desktop');
        expect(frame.width).toBe('390');
        await act(async () =>
            Array.from(host.querySelectorAll('button'))
                .find(button => button.textContent === '电脑')!
                .click(),
        );
        expect(frame.width).toBe('1440');
    });

    it('only sends the latest draft to its own iframe with the matching session and origin', async () => {
        const { host, block, render } = await renderPreview();
        const frame = host.querySelector('iframe')!;
        const doc = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
        const session = doc.documentElement.dataset.decorationSession;
        const send = vi.spyOn(frame.contentWindow!, 'postMessage');
        const event = (source: Window | null, origin: string, previewSession = session) =>
            new MessageEvent('message', {
                source,
                origin,
                data: { type: 'decoration-ready', session: previewSession },
            });
        await act(async () => window.dispatchEvent(event(window, window.location.origin)));
        await act(async () => window.dispatchEvent(event(frame.contentWindow, 'https://other.example')));
        await act(async () =>
            window.dispatchEvent(event(frame.contentWindow, window.location.origin, 'other')),
        );
        expect(send).not.toHaveBeenCalled();
        await act(async () => window.dispatchEvent(event(frame.contentWindow, window.location.origin)));
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'decoration-draft', channelCode: 'shop' }),
            window.location.origin,
        );
        block.translations[0].title = '未保存的新标题';
        await render();
        expect(send).toHaveBeenLastCalledWith(
            expect.objectContaining({
                draft: expect.objectContaining({
                    block: expect.objectContaining({ title: '未保存的新标题' }),
                }),
            }),
            window.location.origin,
        );
    });

    it('removes stale channel previews before exposing another store', async () => {
        const { host, render } = await renderPreview();
        expect(host.querySelector('iframe')).not.toBeNull();
        state.token = 'different-store';
        await render();
        expect(host.querySelector('iframe')).toBeNull();
    });

    it('relays only queries for the selected store without forwarding session credentials', async () => {
        const { host, fetchMock } = await renderPreview();
        const frame = host.querySelector('iframe')!;
        const session = new DOMParser().parseFromString(frame.srcdoc, 'text/html').documentElement.dataset
            .decorationSession;
        const send = vi.spyOn(frame.contentWindow!, 'postMessage');
        fetchMock.mockClear().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: { activeChannel: { id: 'store', code: 'shop' } },
                }),
                { status: 200 },
            ),
        );
        const request = async (query: string) => {
            await act(async () =>
                window.dispatchEvent(
                    new MessageEvent('message', {
                        origin: window.location.origin,
                        source: frame.contentWindow,
                        data: { type: 'decoration-query', id: 'request', session, query, languageCode: 'en' },
                    }),
                ),
            );
        };
        await request('mutation Save { logout { success } }');
        expect(fetchMock).not.toHaveBeenCalled();
        await request('query Read { activeChannel { id code } }');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.objectContaining({ pathname: '/shop-api', search: '?languageCode=en' }),
            expect.objectContaining({
                credentials: 'omit',
                headers: { 'content-type': 'application/json', 'vendure-token': 'fixture' },
            }),
        );
        expect(send).toHaveBeenLastCalledWith(
            expect.objectContaining({
                type: 'decoration-response',
                id: 'request',
                status: 200,
            }),
            window.location.origin,
        );
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: { activeChannel: { id: 'other-store', code: 'other' } },
                }),
            ),
        );
        await request('query Read { activeChannel { id code } }');
        expect(send).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 502 }),
            window.location.origin,
        );
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('当前店铺');
    });
});

it('calls publication published without promising product dependent floor visibility', () => {
    const block = newContentBlock('BEST_SELLERS', 0, '热门商品');
    block.enabled = true;
    block.translations = [
        { languageCode: 'zh_Hans', title: '热门商品', subtitle: '', body: '', ctaLabel: '' },
        { languageCode: 'en', title: 'Popular products', subtitle: '', body: '', ctaLabel: '' },
    ];
    expect(contentPublicationLabels[contentPublicationStatus(block)]).toBe('已发布');
});
