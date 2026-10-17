// organize-imports-ignore -- Keep the production stylesheet cascade.
import type { ShopAbuseAction, ShopAbuseProof } from '../../src/shop-abuse';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import {
    type GptRechargeClient,
    type RechargePlan,
    type RechargeStatus,
} from '../../src/client-plugins/gpt-recharge/contracts';
import { GptRechargePage } from '../../src/client-plugins/gpt-recharge/gpt-recharge-page';
import {
    LocalePreferencesSheet,
    LocalePreferencesTrigger,
} from '../../src/components/common/locale-preferences';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { createStorefrontQueryClient } from '../../src/query-client';
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
function Fixture() {
    const desktop = useDesktopViewport();
    const [language, setLanguage] = useState<'zh' | 'en'>(params.get('language') === 'en' ? 'en' : 'zh');
    const [currency, setCurrency] = useState('CNY');
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [previewDestination, setPreviewDestination] = useState('');
    const [demoCalls, setDemoCalls] = useState(0);
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const localePreferences = {
        storefrontName: '店铺预览',
        currencyCode: currency,
        currencyCodes: ['CNY', 'MYR'],
        currencyLoading: false,
        onToggleLanguage: () => setLanguage(value => (value === 'zh' ? 'en' : 'zh')),
        onCurrencyChange: (value: string) => setCurrency(value),
    };
    const [status, setStatus] = useState<RechargeStatus>('queued');
    const [key, setKey] = useState(0);
    const client = useMemo<GptRechargeClient>(() => {
        let lastPlan: RechargePlan = 'plus';
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
            plan: lastPlan,
            status,
            updatedAt: '2026-10-16T10:30:00Z',
        });
        return {
            config: () => Promise.resolve({ enabled: true, maintenance: false }),
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
                admit('RECHARGE_CODE', code, proof);
                if (!code.startsWith('DEMO-')) return Promise.reject(new Error('Only demo codes'));
                lastPlan = code.includes('200') ? 'pro_20x' : code.includes('100') ? 'pro_5x' : 'plus';
                return Promise.resolve({ plan: lastPlan, status: 'available' });
            },
            submit: (code, _session, proof) => {
                admit('RECHARGE_SUBMIT', code, proof);
                return Promise.resolve(task());
            },
            query: (code, proof) => {
                admit('RECHARGE_CODE', code, proof);
                return Promise.resolve({
                    plan: code.includes('200') ? 'pro_20x' : code.includes('100') ? 'pro_5x' : 'plus',
                    status: status === 'succeeded' ? 'used' : 'reserved',
                    task: task(),
                });
            },
            task: () => Promise.resolve(task()),
        };
    }, [status, key]);
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
            <div
                className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}
                data-route="gpt-recharge"
            >
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
                            onChange={event => setStatus(event.target.value as RechargeStatus)}
                        >
                            <option value="queued">已受理</option>
                            <option value="running">处理中</option>
                            <option value="succeeded">成功</option>
                            <option value="failed">失败</option>
                            <option value="awaiting_review">待核对</option>
                        </select>
                    </label>
                    <button onClick={() => setKey(value => value + 1)}>重置预览</button>
                    <a href={`?skin=${preset === 'classic' ? 'neo-minimalist' : 'classic'}`}>切换皮肤</a>
                </div>
                <header className="gpt-preview-nav">
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
                </header>
                <div className="gpt-preview-content">
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
                </div>
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
            </div>
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
        <RouterProvider router={router} />
        <StorefrontQueryFeedback
            scope={{ marketCode: 'preview:CNY', languageCode: 'zh', includePrivate: true }}
            language="zh"
        />
    </QueryClientProvider>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
