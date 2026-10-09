// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newContentBlock } from './storefront-content-utils';
import { decorationDraft, type DecorationDraft } from './storefront-decoration-model';

const mocks = vi.hoisted(() => ({
    render: vi.fn(),
    clear: vi.fn(),
    setQueriesData: vi.fn(),
    router: { state: { location: { href: '/' } }, history: { replace: vi.fn() } },
}));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: mocks.render }) }));
vi.mock('../../../../storefront/src/storefront-preview-router', () => ({
    createStorefrontPreviewRouter: () => mocks.router,
    QueryClientProvider: () => null,
    RouterProvider: () => null,
}));
vi.mock('../../../../storefront/src/query-client', () => ({
    storefrontQueryClient: { clear: mocks.clear, setQueriesData: mocks.setQueriesData },
}));
vi.mock('../../../../storefront/src/storefront-preview-parameters', () => ({
    setStorefrontPreviewParameters: vi.fn(),
}));
vi.mock('../../../../storefront/src/StorefrontErrorBoundary', () => ({
    StorefrontErrorBoundary: () => null,
}));
vi.mock('../../../../storefront/src/storefront-styles', () => ({}));

let listener: EventListenerOrEventListenerObject | undefined;
let postMessage: ReturnType<typeof vi.spyOn>;
function receive(data: Record<string, unknown>) {
    window.dispatchEvent(
        new MessageEvent('message', {
            origin: window.location.origin,
            source: window.parent,
            data: { ...data, session: 'footer-draft-test' },
        }),
    );
}
function receiveDraft(draft: DecorationDraft) {
    receive({ type: 'decoration-draft', channelCode: 'local-store-a', draft });
}
beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.dataset.decorationSession = 'footer-draft-test';
    vi.stubGlobal('fetch', vi.fn());
    postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
        if (type === 'message') listener = handler;
        add(type, handler, options);
    });
    await import('./storefront-preview-entry');
});
afterEach(() => {
    if (listener) window.removeEventListener('message', listener);
    listener = undefined;
    delete document.documentElement.dataset.decorationSession;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('footer decoration settings reach both actual preview merge paths', () => {
    it.each(['zh_Hans', 'en'] as const)(
        'adds configuration for an unsaved disabled footer in the first Shop response (%s)',
        async language => {
            const footer = newContentBlock('FOOTER', 130);
            footer.enabled = false;
            receiveDraft(decorationDraft(footer, language));
            const pending = window.fetch('/shop-api', {
                method: 'POST',
                body: JSON.stringify({ query: 'query StorefrontContent { storefrontContent { id } }' }),
            });
            const query = postMessage.mock.calls.at(-1)![0] as { id: string; languageCode: string };
            expect(query.languageCode).toBe(language);
            receive({
                type: 'decoration-response',
                id: query.id,
                status: 200,
                payload: {
                    data: {
                        storefrontContent: [],
                        storefrontContentSettings: {
                            heroAutoplayIntervalSeconds: 9,
                            configuredBlockTypes: ['NOTICE'],
                        },
                    },
                },
            });
            expect((await (await pending).json()).data).toEqual({
                storefrontContent: [],
                storefrontContentSettings: {
                    heroAutoplayIntervalSeconds: 9,
                    configuredBlockTypes: ['NOTICE', 'FOOTER'],
                },
            });
        },
    );

    it('retains FOOTER configuration when a live draft is switched off in the cached content', () => {
        const footer = newContentBlock('FOOTER', 130);
        const enabled = decorationDraft(footer, 'zh_Hans');
        receiveDraft(enabled);
        const original = {
            blocks: [enabled.block],
            settings: { configuredBlockTypes: ['NOTICE'], heroAutoplayIntervalSeconds: 7 },
        };
        let next: typeof original | undefined;
        mocks.setQueriesData.mockImplementation((_filters, updater) => {
            next = updater(original);
        });
        footer.enabled = false;
        receiveDraft(decorationDraft(footer, 'zh_Hans'));
        expect(next).toEqual({
            blocks: [],
            settings: { configuredBlockTypes: ['NOTICE', 'FOOTER'], heroAutoplayIntervalSeconds: 7 },
        });
        expect(original.blocks).toEqual([enabled.block]);
        expect(original.settings.configuredBlockTypes).toEqual(['NOTICE']);
    });

    it('keeps other module fallback settings untouched and rejects a response for another store', async () => {
        receiveDraft(decorationDraft(newContentBlock('NOTICE', 0), 'zh_Hans'));
        const request = () =>
            window.fetch('/shop-api', {
                method: 'POST',
                body: JSON.stringify({ query: 'query StorefrontContent { storefrontContent { id } }' }),
            });
        const accepted = request();
        const acceptedId = (postMessage.mock.calls.at(-1)![0] as { id: string }).id;
        receive({
            type: 'decoration-response',
            id: acceptedId,
            status: 200,
            payload: { data: { storefrontContent: [] } },
        });
        expect((await (await accepted).json()).data).not.toHaveProperty('storefrontContentSettings');
        const rejected = request();
        const rejectedId = (postMessage.mock.calls.at(-1)![0] as { id: string }).id;
        const payload = {
            data: {
                activeChannel: { code: 'local-store-b' },
                storefrontContent: [],
                storefrontContentSettings: { configuredBlockTypes: [] },
            },
        };
        receive({ type: 'decoration-response', id: rejectedId, status: 200, payload });
        expect((await rejected).status).toBe(403);
        expect(payload.data.storefrontContentSettings.configuredBlockTypes).toEqual([]);
    });
});
