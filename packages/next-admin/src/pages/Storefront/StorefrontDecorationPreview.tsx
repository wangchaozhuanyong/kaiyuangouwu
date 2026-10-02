import { useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StorefrontVisualPresetId } from '../../../../storefront-content-plugin/src/visual-presets';
import { getActiveChannelToken } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    STOREFRONT_CONTENT_QUERY,
    STOREFRONT_PREVIEW_DOMAINS_QUERY,
    type StorefrontContentBlock,
    type StorefrontContentResult,
    type StorefrontLanguageCode,
    type StorefrontPreviewDomainsResult,
} from '../../graphql/storefront.graphql';
import { storefrontPreviewShopApiUrl } from './storefront-client-preview-url';
import {
    decorationDraft,
    isReadOnlyPreviewQuery,
    previewQueryCurrencyCode,
    type DecorationDraft,
} from './storefront-decoration-model';
import { contentPublicationLabels, contentPublicationStatus } from './storefront-publication';

function ClientFrame({
    block,
    language,
    viewport,
    expanded = false,
    presetId,
    route = '/',
}: {
    block?: StorefrontContentBlock;
    language: StorefrontLanguageCode;
    viewport: 'mobile' | 'desktop';
    expanded?: boolean;
    presetId?: StorefrontVisualPresetId;
    route?: '/' | '/account';
}) {
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, { fetchPolicy: 'no-cache' });
    const channel = query.data?.activeChannel;
    const channelId = channel?.id;
    const channelCode = channel?.code;
    const channelToken = channel?.token;
    const consistent = channel && (!getActiveChannelToken() || channel.token === getActiveChannelToken());
    const domainsQuery = useQuery<StorefrontPreviewDomainsResult>(STOREFRONT_PREVIEW_DOMAINS_QUERY, {
        variables: { channelId: channelId ?? '' },
        skip: !consistent || !channelId,
        fetchPolicy: 'no-cache',
    });
    const apiHref = domainsQuery.loading
        ? null
        : storefrontPreviewShopApiUrl(domainsQuery.data?.storeDomains, channelId);
    const domainError = domainsQuery.error
        ? '当前店铺域名读取失败，请检查域名查看权限与店铺配置。'
        : consistent && channelId && !domainsQuery.loading && !apiHref
          ? '当前店铺没有已验证的可用域名，请先在店铺域名配置中完成验证。'
          : '';
    const frame = useRef<HTMLIFrameElement>(null);
    const host = useRef<HTMLDivElement>(null);
    const [hostWidth, setHostWidth] = useState(390);
    const [documentHtml, setDocumentHtml] = useState('');
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);
    const [retry, setRetry] = useState(0);
    const [session] = useState(() => crypto.randomUUID());
    const draft = useMemo<DecorationDraft>(
        () => ({
            ...(block
                ? decorationDraft(block, language)
                : {
                      block: null,
                      visible: false,
                      route,
                      language: language === 'en' ? 'en' : 'zh',
                  }),
            presetId,
        }),
        [block, language, presetId, route],
    );
    const latestDraft = useRef(draft);
    useEffect(() => {
        latestDraft.current = draft;
    }, [draft]);
    const width = viewport === 'desktop' ? 1440 : 390;
    const height = viewport === 'desktop' ? 900 : 844;
    const scale = Math.min(1, hostWidth / width);

    useEffect(() => {
        const element = host.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHostWidth(element.clientWidth));
        observer.observe(element);
        setHostWidth(element.clientWidth || 390);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!consistent || !channelId || !apiHref) return;
        const controller = new AbortController();
        void Promise.resolve()
            .then(() => {
                if (controller.signal.aborted) return;
                setError('');
                setReady(false);
                setDocumentHtml('');
                return fetch(`${import.meta.env.BASE_URL}storefront-preview.html`, {
                    signal: controller.signal,
                });
            })
            .then(async response => {
                if (!response) return;
                if (!response.ok) throw new Error('预览页面加载失败');
                const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
                const hasClientEntry = Array.from(doc.querySelectorAll('script[type="module"][src]')).some(
                    script => {
                        const entry = script.getAttribute('src') ?? '';
                        return (
                            entry.includes('storefront-preview-entry.tsx') ||
                            entry.includes('/storefrontPreview-')
                        );
                    },
                );
                if (!hasClientEntry) throw new Error('预览入口不可用，请重新构建后台');
                doc.documentElement.dataset.decorationSession = session;
                if (!controller.signal.aborted)
                    setDocumentHtml('<!doctype html>' + doc.documentElement.outerHTML);
            })
            .catch(reason => {
                if (!controller.signal.aborted) setError(reason.message || '预览加载失败');
            });
        return () => controller.abort();
    }, [consistent, channelId, apiHref, session, retry]);

    useEffect(() => {
        if (!consistent || !channelId || !channelToken || !apiHref) return;
        const controller = new AbortController();
        const send = (payload: Record<string, unknown>) => {
            if (controller.signal.aborted) return;
            if (getActiveChannelToken() && getActiveChannelToken() !== channelToken) return;
            frame.current?.contentWindow?.postMessage({ ...payload, session }, window.location.origin);
        };
        const receive = async (event: MessageEvent) => {
            if (
                event.origin !== window.location.origin ||
                event.source !== frame.current?.contentWindow ||
                event.data?.session !== session
            )
                return;
            if (getActiveChannelToken() && getActiveChannelToken() !== channelToken) return;
            if (event.data.type === 'decoration-ready') {
                setReady(true);
                send({ type: 'decoration-draft', draft: latestDraft.current, channelCode });
            } else if (event.data.type === 'decoration-error') {
                setError('客户端预览加载失败，请检查店铺接口后重试。');
            } else if (event.data.type === 'decoration-query') {
                const { id, query: document, variables, languageCode, currencyCode } = event.data;
                if (typeof id !== 'string' || !isReadOnlyPreviewQuery(document)) return;
                try {
                    const endpoint = new URL(apiHref);
                    endpoint.searchParams.set('languageCode', languageCode === 'en' ? 'en' : 'zh_Hans');
                    const queryCurrency = previewQueryCurrencyCode(document, currencyCode);
                    if (queryCurrency) endpoint.searchParams.set('currencyCode', queryCurrency);
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        credentials: 'omit',
                        signal: controller.signal,
                        headers: { 'content-type': 'application/json', 'vendure-token': channelToken },
                        body: JSON.stringify({ query: document, variables }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.errors) throw new Error('店铺接口读取失败');
                    if (payload.data?.activeChannel?.code && payload.data.activeChannel.code !== channelCode)
                        throw new Error('店铺接口与当前店铺不一致');
                    if (payload.data?.activeChannel?.id && payload.data.activeChannel.id !== channelId)
                        throw new Error('店铺接口与当前店铺不一致');
                    if (!controller.signal.aborted)
                        send({ type: 'decoration-response', id, payload, status: response.status });
                } catch {
                    if (!controller.signal.aborted) {
                        setError('当前店铺的客户端数据读取失败，请检查接口与店铺选择后重试。');
                        send({
                            type: 'decoration-response',
                            id,
                            status: 502,
                            payload: { errors: [{ message: 'Preview data unavailable' }] },
                        });
                    }
                }
            }
        };
        window.addEventListener('message', receive);
        const timeout = window.setTimeout(() => {
            if (!frame.current?.contentDocument?.querySelector('.storefront-app'))
                setError('预览未能加载，请重试。');
        }, 30_000);
        return () => {
            controller.abort();
            window.removeEventListener('message', receive);
            window.clearTimeout(timeout);
        };
    }, [consistent, channelId, channelToken, channelCode, apiHref, session, retry]);

    useEffect(() => {
        if (!ready) return;
        frame.current?.contentWindow?.postMessage(
            { type: 'decoration-draft', session, draft },
            window.location.origin,
        );
    }, [ready, draft, session]);

    return (
        <div>
            {query.error && (
                <p role="alert" className="p-3 text-xs text-red-700">
                    当前店铺配置读取失败。
                </p>
            )}
            {!query.error && !domainError && (!consistent || (!documentHtml && !error)) && (
                <p role="status" className="p-3 text-xs">
                    正在加载客户端预览…
                </p>
            )}
            {domainError && (
                <p role="alert" className="p-3 text-xs text-red-700">
                    {domainError}
                </p>
            )}
            {!domainError && error && (
                <div role="alert" className="p-3 text-xs text-red-700">
                    {error}{' '}
                    <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>
                        重试预览
                    </button>
                </div>
            )}
            <div
                ref={host}
                style={{
                    minWidth: 0,
                    overflow: expanded ? 'auto' : 'hidden',
                    height: height * scale,
                    position: 'relative',
                }}
            >
                {documentHtml && consistent && apiHref && (
                    <iframe
                        ref={frame}
                        key={`${channel?.id}:${retry}`}
                        title="客户端装修效果"
                        sandbox="allow-scripts allow-same-origin"
                        srcDoc={documentHtml}
                        width={width}
                        height={height}
                        style={{
                            display: 'block',
                            border: 0,
                            maxWidth: 'none',
                            transform: `scale(${scale})`,
                            transformOrigin: 'top left',
                        }}
                    />
                )}
            </div>
        </div>
    );
}

export function StorefrontDecorationPreview({
    block,
    language,
    fixedViewport,
    presetId,
}: {
    block?: StorefrontContentBlock;
    language: StorefrontLanguageCode;
    fixedViewport?: 'mobile' | 'desktop';
    presetId?: StorefrontVisualPresetId;
}) {
    const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile');
    const [expanded, setExpanded] = useState(false);
    const [revision, setRevision] = useState(0);
    const [route, setRoute] = useState<'/' | '/account'>('/');
    const selectedViewport = fixedViewport ?? viewport;
    const publication = block ? contentPublicationStatus(block, undefined, language) : 'PUBLISHED';
    return (
        <section
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            aria-label="客户端装修预览"
        >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
                <h3 className="text-xs font-bold text-slate-900">
                    客户端效果预览 <FeatureHelpButton topic="storefront.decoration" title="客户端效果预览" />
                </h3>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setRevision(value => value + 1)}
                        className="rounded border px-2 py-1 text-xs"
                    >
                        刷新预览
                    </button>
                    {!fixedViewport &&
                        (['mobile', 'desktop'] as const).map(value => (
                            <button
                                type="button"
                                key={value}
                                aria-pressed={selectedViewport === value}
                                onClick={() => setViewport(value)}
                                className="rounded border px-2 py-1 text-xs"
                            >
                                {value === 'mobile' ? '手机' : '电脑'}
                            </button>
                        ))}
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="rounded border px-2 py-1 text-xs"
                    >
                        放大预览
                    </button>
                </div>
            </header>
            <p className="p-3 text-xs text-slate-500">
                客户端完整页面 · {selectedViewport === 'desktop' ? '1440' : '390'}px 等比缩放 ·{' '}
                {block ? '未保存内容即时预览' : '当前店铺实际内容'}
            </p>
            {!block && (
                <label className="flex items-center gap-2 px-3 pb-3 text-xs text-slate-600">
                    预览页面
                    <select
                        aria-label="预览页面"
                        value={route}
                        onChange={event => setRoute(event.target.value as '/' | '/account')}
                        className="rounded border bg-white px-2 py-1"
                    >
                        <option value="/">首页</option>
                        <option value="/account">个人中心</option>
                    </select>
                </label>
            )}
            {publication !== 'PUBLISHED' && (
                <p role="status" className="px-3 pb-3 text-xs text-amber-700">
                    当前模块{contentPublicationLabels[publication]}，按客户端规则不展示。
                </p>
            )}
            <ClientFrame
                key={`${revision}:${route}`}
                block={block}
                language={language}
                viewport={selectedViewport}
                presetId={presetId}
                route={route}
            />
            {expanded && (
                <AccessibleDialogSurface
                    accessibleName="放大客户端装修预览"
                    onRequestClose={() => setExpanded(false)}
                    className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3"
                >
                    <div className="max-h-[94dvh] w-full max-w-[1500px] overflow-auto rounded-xl bg-white">
                        <header className="flex items-center justify-between p-3">
                            <h3 className="font-bold">
                                客户端效果 · {selectedViewport === 'desktop' ? '电脑' : '手机'}{' '}
                                <FeatureHelpButton topic="storefront.decoration" title="客户端效果预览" />
                            </h3>
                            <button type="button" onClick={() => setExpanded(false)}>
                                关闭预览
                            </button>
                        </header>
                        <ClientFrame
                            key={`${revision}:${route}`}
                            block={block}
                            language={language}
                            viewport={selectedViewport}
                            presetId={presetId}
                            route={route}
                            expanded
                        />
                    </div>
                </AccessibleDialogSurface>
            )}
        </section>
    );
}
