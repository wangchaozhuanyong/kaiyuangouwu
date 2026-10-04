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
    domains: [
        {
            domain: 'shop.example.test',
            status: 'ACTIVE',
            isPrimary: true,
            channel: { id: 'store', code: 'shop' },
        },
    ],
    domainLoading: false,
    domainError: null as Error | null,
}));
vi.mock('@apollo/client/react', () => ({
    useQuery: (query: { definitions: Array<{ name?: { value: string } }> }) =>
        query.definitions.some(definition => definition.name?.value === 'NextAdminStorefrontPreviewDomains')
            ? {
                  data: { storeDomains: state.domains },
                  loading: state.domainLoading,
                  error: state.domainError,
              }
            : { data: state.data },
}));
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
    state.data = { activeChannel: { id: 'store', code: 'shop', token: 'fixture' } };
    state.domains = [
        {
            domain: 'shop.example.test',
            status: 'ACTIVE',
            isPrimary: true,
            channel: { id: 'store', code: 'shop' },
        },
    ];
    state.domainLoading = false;
    state.domainError = null;
});

async function renderPreview(development = false) {
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
                (development ? '<script type="module" src="/@vite/client"></script>' : '') +
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

    it('accepts the client entry after the development server runtime script', async () => {
        const { host } = await renderPreview(true);
        expect(host.querySelector('iframe')?.srcdoc).toContain(
            '/dashboard/assets/storefrontPreview-fixture.js',
        );
        expect(host.querySelector('[role="alert"]')).toBeNull();
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
        block.type = 'FEATURED_COLLECTION';
        block.settings = { displayCount: 6, selectedProductIds: ['1', '2', '3', '4', '5', '6'] };
        block.translations[0].title = '未保存的新标题';
        block.translations[0].body = '说明第一行\n\n说明第二段';
        block.translations[0].subtitle = '副标题第一行\n第二行';
        await render();
        const latestDraft = send.mock.calls.at(-1)?.[0];
        expect(latestDraft.draft.block.body).toBe('说明第一行\n\n说明第二段');
        expect(latestDraft.draft.block.subtitle).toBe('副标题第一行\n第二行');
        expect(send).toHaveBeenLastCalledWith(
            expect.objectContaining({
                draft: expect.objectContaining({
                    block: expect.objectContaining({
                        title: '未保存的新标题',
                        settings: { displayCount: 6, selectedProductIds: ['1', '2', '3', '4', '5', '6'] },
                    }),
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

    it('does not open a preview while domains load or if only pending/other-store domains exist', async () => {
        state.domainLoading = true;
        const { host, render, fetchMock } = await renderPreview();
        expect(host.querySelector('iframe')).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        state.domainLoading = false;
        state.domains[0].status = 'PENDING';
        await render();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('没有已验证');
        expect(host.querySelector('iframe')).toBeNull();
        state.domains[0].status = 'ACTIVE';
        state.domains[0].channel.id = 'previous-store';
        await render();
        expect(host.querySelector('iframe')).toBeNull();
        state.domainError = new Error('Permission denied');
        await render();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('域名查看权限');
    });

    it('aborts previous-store reads and never relays a late response after switching Channel', async () => {
        const { host, render, fetchMock } = await renderPreview();
        const frame = host.querySelector('iframe')!;
        const session = new DOMParser().parseFromString(frame.srcdoc, 'text/html').documentElement.dataset
            .decorationSession;
        const send = vi.spyOn(frame.contentWindow!, 'postMessage');
        let resolveRead!: (response: Response) => void;
        fetchMock.mockClear().mockImplementation(
            () =>
                new Promise<Response>(resolve => {
                    resolveRead = resolve;
                }),
        );
        await act(async () =>
            window.dispatchEvent(
                new MessageEvent('message', {
                    source: frame.contentWindow,
                    origin: window.location.origin,
                    data: {
                        type: 'decoration-query',
                        id: 'old-read',
                        session,
                        query: 'query Read { activeChannel { id code } }',
                    },
                }),
            ),
        );
        const options = fetchMock.mock.calls[0][1]!;
        expect(options.signal?.aborted).toBe(false);
        state.token = 'other-token';
        state.data = { activeChannel: { id: 'other-store', code: 'other', token: 'other-token' } };
        state.domains = [
            {
                domain: 'other.example.test',
                status: 'ACTIVE',
                isPrimary: true,
                channel: { id: 'other-store', code: 'other' },
            },
        ];
        fetchMock.mockResolvedValue(
            new Response(
                '<script type="module" src="/dashboard/assets/storefrontPreview-fixture.js"></script>',
            ),
        );
        await render();
        expect(options.signal?.aborted).toBe(true);
        await act(async () =>
            resolveRead(
                new Response(JSON.stringify({ data: { activeChannel: { id: 'store', code: 'shop' } } })),
            ),
        );
        expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'old-read' }), expect.anything());
        const nextFrame = host.querySelector('iframe')!;
        const nextSession = new DOMParser().parseFromString(nextFrame.srcdoc, 'text/html').documentElement
            .dataset.decorationSession;
        fetchMock
            .mockClear()
            .mockResolvedValue(
                new Response(
                    JSON.stringify({ data: { activeChannel: { id: 'other-store', code: 'other' } } }),
                ),
            );
        await act(async () =>
            window.dispatchEvent(
                new MessageEvent('message', {
                    source: nextFrame.contentWindow,
                    origin: window.location.origin,
                    data: {
                        type: 'decoration-query',
                        id: 'new-read',
                        session: nextSession,
                        query: 'query Read { activeChannel { id code } }',
                    },
                }),
            ),
        );
        expect(fetchMock).toHaveBeenCalledWith(
            expect.objectContaining({ origin: 'https://other.example.test' }),
            expect.objectContaining({ credentials: 'omit' }),
        );
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
            expect.objectContaining({
                origin: 'https://shop.example.test',
                pathname: '/shop-api',
                search: '?languageCode=en',
            }),
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

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
