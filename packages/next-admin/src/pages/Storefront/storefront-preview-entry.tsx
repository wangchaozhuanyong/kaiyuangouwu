// organize-imports-ignore -- share the exact client CSS cascade, isolated inside this document.
import {
    QueryClientProvider,
    RouterProvider,
    createStorefrontPreviewRouter,
} from '../../../../storefront/src/storefront-preview-router';
import { createRoot } from 'react-dom/client';
import { storefrontQueryClient } from '../../../../storefront/src/query-client';
import { setStorefrontPreviewParameters } from '../../../../storefront/src/storefront-preview-parameters';
import { StorefrontErrorBoundary } from '../../../../storefront/src/StorefrontErrorBoundary';
import type { StorefrontContentResponse } from '../../../../storefront/src/types';
import '../../../../storefront/src/storefront-styles';
import {
    applyDecorationDraft,
    isReadOnlyPreviewQuery,
    type DecorationDraft,
} from './storefront-decoration-model';

const session = document.documentElement.dataset.decorationSession;
const origin = window.location.origin === 'null' ? new URL(document.baseURI).origin : window.location.origin;
const pending = new Map<
    string,
    { resolve: (response: Response) => void; reject: (reason: Error) => void; cleanup: () => void }
>();
let draft: DecorationDraft | undefined;
let renderedLanguage: string | undefined;
let renderedPreset: string | undefined;
let expectedChannel: string | undefined;
let router: ReturnType<typeof createStorefrontPreviewRouter> | undefined;
const rootElement = document.getElementById('root');
const root = rootElement ? createRoot(rootElement) : undefined;

function send(payload: Record<string, unknown>) {
    window.parent.postMessage({ ...payload, session }, origin);
}

function respondWithError(message: string): Response {
    return new Response(JSON.stringify({ errors: [{ message }] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
    });
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), document.baseURI);
    if (url.pathname.includes('/storefront-realtime')) return new Response(null, { status: 204 });
    if (/\/shop-api\/?$/u.test(url.pathname)) {
        let body: { query?: string; variables?: Record<string, unknown> };
        try {
            body = JSON.parse(
                typeof init?.body === 'string'
                    ? init.body
                    : input instanceof Request
                      ? await input.clone().text()
                      : '{}',
            );
        } catch {
            return respondWithError('Decoration preview is read only');
        }
        if (!isReadOnlyPreviewQuery(body.query)) return respondWithError('Decoration preview is read only');
        const query = body.query;
        const id = crypto.randomUUID();
        return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal;
            const abort = () => {
                pending.get(id)?.cleanup();
                pending.delete(id);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            const timer = window.setTimeout(() => {
                pending.get(id)?.cleanup();
                pending.delete(id);
                reject(new Error('Preview request timed out'));
            }, 25_000);
            const cleanup = () => {
                window.clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
            };
            if (signal?.aborted) {
                cleanup();
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            signal?.addEventListener('abort', abort, { once: true });
            pending.set(id, { resolve, reject, cleanup });
            send({
                type: 'decoration-query',
                id,
                query,
                variables: body.variables,
                languageCode: draft?.language === 'en' ? 'en' : 'zh_Hans',
                currencyCode: url.searchParams.get('currencyCode'),
            });
        });
    }
    // Assets can load normally. Network writes and tracking stay outside this preview.
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'GET' && method !== 'HEAD') return respondWithError('Decoration preview is read only');
    return nativeFetch(input, init);
};

document.addEventListener('submit', event => event.preventDefault(), true);
document.addEventListener(
    'click',
    event => {
        const anchor = event.target instanceof Element ? event.target.closest('a') : null;
        if (anchor) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    },
    true,
);

function render(next: DecorationDraft) {
    if (!root) return;
    const parameters = new URLSearchParams({
        storefrontPreviewEmbedded: '1',
        storefrontPreviewBlockId: next.block?.id ?? '',
        storefrontPreviewDocumentUrl: new URL('/', origin).href,
        storefrontPreviewLanguage: next.language,
        storefrontPreviewAuth: next.block?.type === 'ACCOUNT_HERO' ? 'authenticated' : 'guest',
    });
    if (next.presetId) parameters.set('storefrontPreviewPreset', next.presetId);
    setStorefrontPreviewParameters(parameters);
    if (!router || renderedLanguage !== next.language || renderedPreset !== next.presetId) {
        storefrontQueryClient.clear();
        router = createStorefrontPreviewRouter(next.route);
        renderedLanguage = next.language;
        renderedPreset = next.presetId;
        root.render(
            <QueryClientProvider client={storefrontQueryClient}>
                <StorefrontErrorBoundary>
                    <RouterProvider key={`${next.language}:${next.presetId ?? 'saved'}`} router={router} />
                </StorefrontErrorBoundary>
            </QueryClientProvider>,
        );
    } else {
        storefrontQueryClient.setQueriesData<StorefrontContentResponse>(
            {
                predicate: query =>
                    query.queryKey.includes('content') || query.queryKey.includes('account-content'),
            },
            data => (data ? { ...data, blocks: applyDecorationDraft(data.blocks, next) } : data),
        );
        if (router.state.location.href !== next.route) void router.history.replace(next.route);
    }
}

window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== window.parent || event.data?.session !== session) return;
    if (event.data.type === 'decoration-draft') {
        const next = event.data.draft as DecorationDraft;
        if (
            !next ||
            (next.block && !Array.isArray(next.block.items)) ||
            !['zh', 'en'].includes(next.language)
        )
            return;
        if (typeof event.data.channelCode === 'string') expectedChannel = event.data.channelCode;
        draft = next;
        render(next);
    } else if (event.data.type === 'decoration-response') {
        const request = pending.get(event.data.id);
        if (!request) return;
        request.cleanup();
        pending.delete(event.data.id);
        const payload = event.data.payload;
        if (payload.data?.activeChannel?.code && payload.data.activeChannel.code !== expectedChannel) {
            request.resolve(respondWithError('Preview store does not match'));
            send({ type: 'decoration-error' });
            return;
        }
        if (draft && Array.isArray(payload.data?.storefrontContent))
            payload.data.storefrontContent = applyDecorationDraft(payload.data.storefrontContent, draft);
        request.resolve(
            new Response(JSON.stringify(payload), {
                status: event.data.status,
                headers: { 'content-type': 'application/json' },
            }),
        );
    }
});

if (session && window.parent !== window) send({ type: 'decoration-ready' });
else if (rootElement) rootElement.textContent = '请从商城装修页面打开预览。';
