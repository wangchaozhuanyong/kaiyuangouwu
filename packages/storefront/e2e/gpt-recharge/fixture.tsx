// organize-imports-ignore -- Keep the production stylesheet cascade.
import type { ShopAbuseAction, ShopAbuseProof } from '../../src/shop-abuse';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import {
    type GptRechargeClient,
    isPartnerRechargeCode,
    type RechargePlan,
    type RechargeStage,
    type RechargeStatus,
    type RechargeProgress,
} from '../../src/client-plugins/gpt-recharge/contracts';
import { GptRechargePage } from '../../src/client-plugins/gpt-recharge/gpt-recharge-page';
import {
    LocalePreferencesSheet,
    LocalePreferencesTrigger,
} from '../../src/components/common/locale-preferences';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { PageReadinessBoundary } from '../../src/page-readiness';
import { createStorefrontQueryClient } from '../../src/query-client';
import { ShopApiGraphQlError } from '../../src/shop-api-errors';
import { StorefrontPageFrame } from '../../src/storefront-page-frame';
import { StorefrontQueryFeedback } from '../../src/StorefrontQueryFeedback';

import demoChallengeImage from './assets/abuse-demo.png?inline';

import '../../src/storefront-styles';
import '../../src/commerce-styles';
import './preview.css';

const params = new URLSearchParams(location.search);
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.dataset.storefrontPreset = preset;
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);
const demoSession = JSON.stringify(
    {
        user: { id: 'preview-user', email: 'preview@example.test' },
        accessToken: 'demo-only-not-a-valid-access-credential',
        expires: '2099-01-01T00:00:00Z',
    },
    null,
    2,
);
const demoPartnerCode = 'RA-' + 'A'.repeat(32);

function demoPlanForCode(code: string): RechargePlan {
    if (code === 'DEMO-500' || code === demoPartnerCode) return 'pro500';
    if (code.includes('200')) return 'pro_20x';
    if (code.includes('100')) return 'pro_5x';
    return 'plus';
}

function Fixture() {
    const desktop = useDesktopViewport();
    const [language, setLanguage] = useState<'zh' | 'en'>(params.get('language') === 'en' ? 'en' : 'zh');
    const [currency, setCurrency] = useState('CNY');
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [previewDestination, setPreviewDestination] = useState('');
    const [demoCalls, setDemoCalls] = useState(0);
    const [operationCalls, setOperationCalls] = useState({ verify: 0, query: 0, submit: 0, task: 0 });
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const localePreferences = {
        storefrontName: '店铺预览',
        currencyCode: currency,
        currencyCodes: ['CNY', 'MYR'],
        currencyLoading: false,
        onToggleLanguage: () => setLanguage(value => (value === 'zh' ? 'en' : 'zh')),
        onCurrencyChange: (value: string) => setCurrency(value),
    };
    const [status, setStatus] = useState<RechargeStatus>(params.has('detailed') ? 'running' : 'queued');
    const [stage, setStage] = useState<RechargeStage>('started');
    const [progressVersion, setProgressVersion] = useState(6);
    const [key, setKey] = useState(0);
    const taskPlan = useRef<RechargePlan>('plus');
    const client = useMemo<GptRechargeClient>(() => {
        const availability = params.get('availability');
        let maintenance = availability === 'maintenance';
        let verifiedCode: string | undefined;
        let challengeSequence = 0;
        const spent = new Set<string>();
        const issued = new Map<string, { action: string; target: string }>();
        const limited = new Set<string>();
        function admit(action: ShopAbuseAction, target: string, proof?: ShopAbuseProof) {
            setDemoCalls(value => value + 1);
            if (!params.get('abuse')) return;
            const mode = params.get('abuse');
            const reject = (errorCode: string, retryAfterSeconds = 0) => {
                throw Object.assign(new Error('Synthetic security preflight rejection'), {
                    errorCode,
                    action,
                    retryAfterSeconds,
                });
            };
            if (mode === 'rate' || mode === 'unavailable') {
                if (!limited.has(action)) {
                    limited.add(action);
                    reject(
                        mode === 'rate' ? 'SHOP_ABUSE_RATE_LIMITED' : 'SHOP_ABUSE_UNAVAILABLE',
                        mode === 'rate' ? 1 : 0,
                    );
                }
                return;
            }
            if (!proof) reject('SHOP_ABUSE_CHALLENGE_REQUIRED');
            if (!proof) return;
            const binding = issued.get(proof.id);
            const valid = binding?.action === action && binding.target === target && !spent.has(proof.id);
            spent.add(proof.id);
            if (!valid || proof.answer !== 'ABC234') reject('SHOP_ABUSE_CHALLENGE_INVALID');
        }
        const task = () => ({
            id: 'DEMO-20261016-001',
            credential: 'preview-only',
            plan: taskPlan.current,
            status,
            stage: status === 'running' ? stage : status,
            updatedAt: '2026-10-16T10:30:00Z',
            ...(params.has('detailed') && {
                accountEmail: 'customer-with-a-long-email-address@example.test',
                progress: {
                    attempt: 'synthetic-attempt',
                    execution: 1,
                    version: progressVersion,
                    changedAt: '2026-10-16T10:30:00Z',
                    milestones: [
                        { key: 'accepted', state: 'complete', at: '2026-10-16T10:25:00Z' },
                        { key: 'account', state: 'complete', at: '2026-10-16T10:26:00Z' },
                        { key: 'checkout', state: 'complete', at: '2026-10-16T10:27:00Z' },
                        { key: 'card', state: 'complete', at: '2026-10-16T10:28:00Z' },
                        { key: 'billing', state: 'complete', at: '2026-10-16T10:29:00Z' },
                        { key: 'payment', state: 'waiting', at: '2026-10-16T10:30:00Z' },
                        ...(status === 'succeeded'
                            ? [{ key: 'complete', state: 'complete', at: '2026-10-16T10:31:00Z' }]
                            : []),
                    ],
                } as RechargeProgress,
            }),
        });
        return {
            config: async () => {
                const delay = Math.min(20_000, Math.max(0, Number(params.get('config-delay')) || 0));
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                if (availability === 'error') throw new Error('Synthetic configuration outage');
                const config = { enabled: availability !== 'disabled', maintenance };
                maintenance = false;
                return config;
            },
            createShopAbuseChallenge: (action, target) => {
                const id = (++challengeSequence).toString(16).padStart(48, '0');
                issued.set(id, { action, target });
                return Promise.resolve({
                    id,
                    imageDataUrl: demoChallengeImage,
                    expiresAt: new Date(Date.now() + 120000).toISOString(),
                });
            },
            verify: async (code, proof) => {
                setOperationCalls(value => ({ ...value, verify: value.verify + 1 }));
                admit('RECHARGE_CODE', code, proof);
                const errorMode = params.get('error');
                if (code === 'DEMO-INVALID')
                    throw new ShopApiGraphQlError(
                        ['兑换码无效或已停用，请核对后重试'],
                        200,
                        'USER_INPUT_ERROR',
                    );
                if (code === 'DEMO-HELD')
                    return { plan: 'plus', status: 'reserved', reason: 'manual_review_required' };
                if (code === 'DEMO-REVIEWED')
                    return { plan: 'plus', status: 'available', reason: 'verified_retry_available' };
                if (errorMode === 'verify-code-rejected')
                    throw new ShopApiGraphQlError(
                        ['兑换码无效或已停用，请核对后重试'],
                        200,
                        'USER_INPUT_ERROR',
                    );
                if (errorMode === 'verify' || (errorMode === 'verify-repeat' && code === verifiedCode))
                    throw new Error('Synthetic private verification provider detail');
                if (!code.startsWith('DEMO-') && code !== demoPartnerCode)
                    return Promise.reject(new Error('Only demo codes'));
                verifiedCode = code;
                return Promise.resolve({ plan: demoPlanForCode(code), status: 'available' });
            },
            submit: async (code, _session, proof) => {
                setOperationCalls(value => ({ ...value, submit: value.submit + 1 }));
                admit('RECHARGE_SUBMIT', code, proof);
                if (params.get('error') === 'submit-rejected')
                    throw Object.assign(new Error('Synthetic proven pre-acceptance rejection'), {
                        errorCode: 'GPT_RECHARGE_NOT_ACCEPTED',
                    });
                if (params.get('error') === 'submit-unknown')
                    throw new Error('Synthetic lost response after submission');
                taskPlan.current = demoPlanForCode(code);
                return Promise.resolve(task());
            },
            query: async (code, proof) => {
                setOperationCalls(value => ({ ...value, query: value.query + 1 }));
                admit('RECHARGE_CODE', code, proof);
                if (code === 'DEMO-HELD')
                    return { plan: 'plus', status: 'reserved', reason: 'manual_review_required' };
                if (code === 'DEMO-REVIEWED')
                    return {
                        plan: 'plus',
                        status: 'available',
                        reason: 'verified_retry_available',
                        task: { ...task(), plan: 'plus', status: 'failed', stage: 'failed' },
                    };
                if (params.get('error') === 'query')
                    throw new Error('Synthetic private lookup provider detail');
                taskPlan.current = demoPlanForCode(code);
                return Promise.resolve({
                    plan: taskPlan.current,
                    status: status === 'succeeded' ? 'used' : 'reserved',
                    task: task(),
                });
            },
            authorize: (code, _requestKey, proof) => {
                admit('RECHARGE_SUBMIT', code, proof);
                if (!isPartnerRechargeCode(code)) return Promise.reject(new Error('Only demo partner code'));
                taskPlan.current = demoPlanForCode(code);
                setStatus('awaiting_authorization');
                return Promise.resolve({
                    authorizationUrl: 'https://id.example.test/recharge/authorize#fixture',
                    task: { ...task(), status: 'awaiting_authorization', stage: 'awaiting_authorization' },
                });
            },
            ...(params.has('detailed') && {
                watch: async (
                    _id: string,
                    _credential: string,
                    signal: AbortSignal,
                    onTask: (value: ReturnType<typeof task>) => void,
                    onConnection: (state: 'live') => void,
                ) => {
                    onConnection('live');
                    onTask(task());
                    await new Promise<void>(resolve => {
                        if (signal.aborted) return resolve();
                        signal.addEventListener('abort', () => resolve(), { once: true });
                    });
                },
            }),
            task: () => {
                setOperationCalls(value => ({ ...value, task: value.task + 1 }));
                if (params.get('error') === 'progress')
                    throw Object.assign(new Error('Synthetic private progress failure'), {
                        errorCode: 'FORBIDDEN',
                    });
                return Promise.resolve(task());
            },
        };
    }, [status, stage, key, progressVersion]);
    function fill() {
        const input = document.getElementById('gpt-code') as HTMLInputElement | null;
        const textarea = document.getElementById('gpt-session') as HTMLTextAreaElement | null;
        if (input) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                input,
                'DEMO-PLUS-001',
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (textarea) {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
                textarea,
                demoSession,
            );
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <output
                hidden
                data-demo-verify-calls={operationCalls.verify}
                data-demo-query-calls={operationCalls.query}
                data-demo-submit-calls={operationCalls.submit}
                data-demo-task-calls={operationCalls.task}
            />
            <div className="gpt-preview-toolbar" hidden={params.get('presentation') === '1'}>
                <span>设计预览 · 演示数据</span>
                {params.get('abuse') ? (
                    <output data-demo-abuse-calls={demoCalls}>
                        安全验证演示 · 答案 ABC234 · 已请求 {demoCalls} 次
                    </output>
                ) : null}
                <button onClick={() => void fill()}>填入演示资料</button>
                <label>
                    结果演示
                    <select
                        value={status}
                        onChange={event => {
                            setStatus(event.target.value as RechargeStatus);
                            setProgressVersion(value => value + 1);
                        }}
                    >
                        <option value="queued">已受理</option>
                        <option value="running">处理中</option>
                        <option value="succeeded">成功</option>
                        <option value="failed">失败</option>
                        <option value="awaiting_review">待核对</option>
                    </select>
                </label>
                <label>
                    步骤演示
                    <select
                        value={stage}
                        onChange={event => {
                            setStage(event.target.value as RechargeStage);
                            setProgressVersion(value => value + 1);
                        }}
                    >
                        <option value="started">已开始执行</option>
                        <option value="payment_details">填写充值资料</option>
                        <option value="paying">正在付款</option>
                        <option value="paid">付款已确认</option>
                        <option value="subscription_check">确认订阅</option>
                    </select>
                </label>
                <button onClick={() => setKey(value => value + 1)}>重置预览</button>
                <a href={`?skin=${preset === 'classic' ? 'neo-minimalist' : 'classic'}`}>切换皮肤</a>
            </div>
            <StorefrontPageFrame
                routeName="gpt-recharge"
                language={language}
                desktop={desktop}
                storefrontName={localePreferences.storefrontName}
                logoUrl={null}
                header={
                    <div className="proto-header-inner gpt-preview-nav">
                        <strong>{t('店铺预览', 'Store preview')}</strong>
                        <nav>
                            <span>{t('首页', 'Home')}</span>
                            <span>{t('商品', 'Products')}</span>
                            <span aria-current="page">{t('智能服务', 'Services')}</span>
                        </nav>
                        <LocalePreferencesTrigger
                            language={language}
                            currencyCode={currency}
                            expanded={preferencesOpen}
                            onClick={() => setPreferencesOpen(true)}
                        />
                    </div>
                }
            >
                <GptRechargePage
                    key={key}
                    marketKey={`preview:${currency}`}
                    language={language}
                    initialTab={
                        params.get('tab') === 'guide'
                            ? 'guide'
                            : params.get('tab') === 'query'
                              ? 'query'
                              : 'recharge'
                    }
                    localePreferences={localePreferences}
                    client={client}
                    productCollections={[
                        {
                            id: 'preview-chatgpt-category',
                            name: 'GPT成品',
                            slug: 'chatgpt',
                            description: '',
                            position: 0,
                            parentId: 'preview-root',
                            featuredAsset: null,
                        },
                    ]}
                    onBack={() => setKey(value => value + 1)}
                    onViewProducts={() =>
                        setPreviewDestination(
                            t('演示：打开 ChatGPT 商品分类', 'Demo: open the ChatGPT product category'),
                        )
                    }
                    onContactSupport={() =>
                        setPreviewDestination(t('演示：打开本站客服页面', 'Demo: open store support'))
                    }
                />
                <p className="gpt-preview-caption" role="status">
                    {previewDestination ||
                        t(
                            '方案二 · 真实页面组件 · 演示数据',
                            'Concept 2 · Actual page component · Demo data',
                        )}
                </p>
                {preferencesOpen && (
                    <LocalePreferencesSheet
                        storefrontLabel={localePreferences.storefrontName}
                        language={language}
                        currencyCodes={localePreferences.currencyCodes}
                        selectedCurrencyCode={currency}
                        currencyLoading={false}
                        onToggleLanguage={localePreferences.onToggleLanguage}
                        onSelectCurrency={localePreferences.onCurrencyChange}
                        onClose={() => setPreferencesOpen(false)}
                    />
                )}
            </StorefrontPageFrame>
        </DesktopLayoutContext.Provider>
    );
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const queryClient = createStorefrontQueryClient();
const container = document.getElementById('root');
if (!container) throw new Error('Preview root missing');
const root = createRoot(container);
root.render(
    <QueryClientProvider client={queryClient}>
        <PageReadinessBoundary
            pending={false}
            online
            language={params.get('language') === 'en' ? 'en' : 'zh'}
            onRetry={() => undefined}
            onBack={() => undefined}
        >
            <RouterProvider router={router} />
        </PageReadinessBoundary>
        <StorefrontQueryFeedback
            scope={{ marketCode: 'preview:CNY', languageCode: 'zh', includePrivate: true }}
            language="zh"
        />
    </QueryClientProvider>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
