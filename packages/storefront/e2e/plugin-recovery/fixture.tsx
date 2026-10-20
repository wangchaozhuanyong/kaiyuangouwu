import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { type ShopApi } from '../../src/api';
import { CustomerTwoFactorEntry } from '../../src/client-plugins/two-factor/isolated-entry';
import { clearStudioCache, getStudioCachedData } from '../../src/pages/ai-image-studio-cache';
import { AiImageStudioPage } from '../../src/pages/ai-image-studio-page';
import '../../src/styles.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/visual-presets.css';
import { type ActiveCustomer, type ImageStudioConfig, type MarketConfig } from '../../src/types';

// Only API reads and the outer navigation are fixtures. Both rendered plugins are production components.
const language = new URLSearchParams(location.search).get('language') === 'en' ? 'en' : 'zh';
const market: MarketConfig = {
    code: 'plugin-recovery',
    currencyCode: 'CNY',
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'CN',
    label: 'Synthetic local fixture',
};
const customer = { id: 'synthetic-plugin-customer' } as ActiveCustomer;
const bucket = {
    limit: 20,
    unlimited: false,
    reserved: 0,
    consumed: 0,
    remaining: 20,
    windowEndsAt: '2099-01-01',
};
const promptQuota = {
    paidEnabled: true,
    paidPrice: 50,
    currencyCode: 'CNY',
    daily: { ...bucket, remaining: 0 },
    minute: bucket,
};
const modelQuotas = [
    {
        modelCode: 'fixture-model',
        freeImageEnabled: true,
        paidAfterFreeEnabled: true,
        free: bucket,
        safety: bucket,
    },
];
const config = {
    enabled: true,
    promptOptimizationEnabled: true,
    promptOptimizerModelIds: ['fixture'],
    defaultModelCode: 'fixture-model',
    termsVersion: 'fixture-v1',
    termsZh: '本地合成服务条款',
    termsEn: 'Synthetic local terms',
    maxQuantity: 4,
    outputRetentionDays: 90,
    referenceRetentionHours: 24,
    models: [
        {
            id: 'fixture-model',
            code: 'fixture-model',
            displayNameZh: '本地测试模型',
            displayNameEn: 'Local test model',
            officialModelId: 'fixture',
            resolutionOptions: [{ resolution: '1K', unitPrice: 100, supportedAspectRatios: ['1:1'] }],
            unitPrice: 100,
            currencyCode: 'CNY',
            dailyGenerationSafetyLimit: 20,
            freeImageEnabled: true,
            dailyFreeImageLimit: 20,
            paidAfterFreeEnabled: true,
        },
    ],
} as ImageStudioConfig;
let failed = new Set<string>();
const calls: string[] = [];
const writes: string[] = [];
const read = <T,>(name: string, value: T): Promise<T> => {
    calls.push(name);
    return failed.has(name)
        ? Promise.reject(new Error(`Synthetic ${name} unavailable`))
        : Promise.resolve(value);
};
const readApi = {
    imageStudioConfig: () => read('config', config),
    imageStudioWallet: () => read('wallet', { availableBalance: 2500, currencyCode: 'CNY' }),
    imagePromptQuotaStatus: () => read('promptQuota', promptQuota),
    imageModelQuotaStatus: () => read('modelQuotas', modelQuotas),
    myImageGenerationJobs: () => read('history', { items: [], totalItems: 0 }),
    previewImageGenerationPrompt: () => read('promptPreview', { length: 120, limit: 8000, valid: true }),
};
const api = new Proxy(readApi, {
    get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return () => {
            writes.push(String(property));
            return Promise.reject(new Error('Fixture blocks all write operations'));
        };
    },
}) as unknown as ShopApi;
const fixture = {
    fail(names: string[]) {
        failed = new Set(names);
    },
    clear: clearStudioCache,
    snapshot: () => structuredClone(getStudioCachedData(market.code, customer.id)),
    calls,
    writes,
};
Object.assign(window, { pluginRecovery: fixture });

function Fixture() {
    const [page, setPage] = useState('home');
    const [owner, setOwner] = useState(customer);
    const [notice, setNotice] = useState('');
    return (
        <>
            <nav
                aria-label="Local verification controls"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12 }}
            >
                <button onClick={() => setPage('home')}>Fixture home</button>
                <button onClick={() => setPage('studio')}>Open studio</button>
                <button onClick={() => setPage('vault')}>Open vault</button>
                <button onClick={() => setOwner({ id: 'synthetic-second-owner' } as ActiveCustomer)}>
                    Change owner
                </button>
            </nav>
            {notice && <p role="status">{notice}</p>}
            {page === 'home' && <p>Local synthetic customer and read-only API fixtures.</p>}
            {page === 'studio' && (
                <AiImageStudioPage
                    api={api}
                    customer={customer}
                    market={market}
                    displayCurrencyCode="CNY"
                    language={language}
                    onBack={() => setPage('home')}
                    onSignIn={() => undefined}
                    onNotify={setNotice}
                />
            )}
            {page === 'vault' && (
                <CustomerTwoFactorEntry
                    customer={owner}
                    language={language}
                    onBack={() => setPage('home')}
                    onSignIn={() => undefined}
                    onNotify={setNotice}
                />
            )}
        </>
    );
}
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
createRoot(root).render(<Fixture />);
