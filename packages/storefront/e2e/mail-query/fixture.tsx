// organize-imports-ignore -- Keep type imports ahead of runtime imports, as required by ESLint.
import type { ShopApi } from '../../src/api';
import { createRoot } from 'react-dom/client';

import { MailQueryPage } from '../../src/client-plugins/mail-query/mail-query-page';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

// Local synthetic data only; this harness never connects to a mailbox or database.
const params = new URLSearchParams(location.search);
const code = 'AbCdEfGhJkMnPqRsTuV2';
let reads = 0;
let attempts = 0;
const api = {
    queryMails: async (input: string) => {
        await Promise.resolve();
        document.documentElement.dataset.mailQueryAttempts = String(++attempts);
        if (params.has('cooldown') && attempts === 1) {
            return {
                success: false,
                message: '本地模拟查询冷却',
                retryAfterSeconds: Number(params.get('cooldown')) || 60,
                items: [],
                totalEmails: 0,
            };
        }
        if (input !== code) return { success: false, message: '模拟查询码大小写不匹配', items: [] };
        reads++;
        const items = params.has('empty')
            ? []
            : [
                  {
                      id: 'synthetic-message',
                      fromAddress: 'sender@example.invalid',
                      subject: `模拟邮件 · 第 ${reads} 次读取`,
                      receivedAt: '2026-10-27T08:00:00.000Z',
                      bodyText: '这是本地验收邮件。',
                      bodyHtml: '<p>这是本地验收邮件。</p>',
                  },
              ];
        return {
            success: true,
            targetType: 'MANAGED',
            aliasEmail: 'buyer@example.invalid',
            totalEmails: items.length,
            items,
        };
    },
    watchMailEvents: (_input, callbacks) => {
        // A managed inbox must never subscribe to Vendure's local mailbox stream.
        callbacks.onStatus('denied');
        return Promise.resolve();
    },
} as Pick<ShopApi, 'queryMails' | 'watchMailEvents'>;

applyStorefrontVisualPreset(document.documentElement, params.has('classic') ? 'classic' : 'neo-minimalist');
const root = document.getElementById('root');
if (!root) throw new Error('Mail query fixture root is missing');
createRoot(root).render(
    <MailQueryPage
        api={api as ShopApi}
        marketCode="local-mail-query"
        language={params.has('en') ? 'en' : 'zh'}
        onBack={() => undefined}
    />,
);
