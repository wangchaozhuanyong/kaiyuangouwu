import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PORTAL_HTML } from './portal-html';
import { PORTAL_JS } from './portal-script';

type PortalWindow = Window &
    typeof globalThis & {
        doQuery: (code: string) => Promise<void>;
        refreshCurrentQuery: () => Promise<void>;
        goBack: () => void;
        filterMails: () => void;
    };
type PortalDom = { window: PortalWindow };
// Use the existing test runtime without adding a browser-only type dependency to the plugin.
const { JSDOM } = createRequire(`${process.cwd()}/package.json`)('jsdom') as {
    JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => PortalDom;
};
const windows: PortalDom[] = [];
afterEach(() => windows.splice(0).forEach(dom => dom.window.close()));

async function portal(
    branding: unknown = {
        activeChannel: { id: 'store-a' },
        storefrontBranding: { name: '测试店铺甲' },
        storefrontVisualPreset: { channelId: 'store-a', presetId: 'modern-oriental' },
    },
) {
    const dom = new JSDOM(PORTAL_HTML, {
        url: 'https://store.example/mail-query',
        runScripts: 'outside-only',
    });
    windows.push(dom);
    const requests: Array<{ signal: AbortSignal; resolve: (data: unknown) => void }> = [];
    dom.window.fetch = vi.fn((_url, init) => {
        if (JSON.parse(String(init?.body)).query.includes('MailPortalBranding')) {
            return Promise.resolve(Response.json({ data: branding }));
        }
        return new Promise<Response>(resolve =>
            requests.push({
                signal: init?.signal as AbortSignal,
                resolve: data => resolve(Response.json({ data: { icloudQueryMails: data } })),
            }),
        );
    });
    await new Promise<void>(resolve => dom.window.addEventListener('DOMContentLoaded', () => resolve()));
    dom.window.eval(PORTAL_JS);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 0));
    return { window: dom.window, document: dom.window.document, requests };
}

function result(subject: string, targetType = 'PRIMARY') {
    return {
        success: true,
        targetType,
        primaryEmail: 'own***@example.com',
        totalEmails: 2,
        items: [
            {
                id: 'm1',
                virtualEmailId: 'v1',
                subject,
                targetEmail: 'ali***@example.com',
                fromAddress: 'sender@example.com',
            },
            {
                id: 'm2',
                virtualEmailId: 'v2',
                subject: 'second mailbox',
                targetEmail: 'ali***@example.com',
                fromAddress: 'sender@example.com',
            },
        ],
        virtualEmailsList: [
            { id: 'v1', aliasEmail: 'ali***@example.com' },
            { id: 'v2', aliasEmail: 'ali***@example.com' },
        ],
    };
}

describe('mail portal request ownership', () => {
    it('ignores a late refresh after returning and querying another code', async () => {
        const { window, document, requests } = await portal();
        const first = window.doQuery('MSTR-AAAA-BBBB');
        requests[0].resolve(result('old mailbox'));
        await first;
        const refresh = window.refreshCurrentQuery();
        window.goBack();
        expect(requests[1].signal.aborted).toBe(true);
        const next = window.doQuery('BUY-CCCC-DDDD');
        requests[2].resolve(result('new mailbox', 'VIRTUAL'));
        await next;
        requests[1].resolve(result('stale refresh'));
        await refresh;
        expect(document.getElementById('mailList')?.textContent).toContain('new mailbox');
        expect(document.getElementById('mailList')?.textContent).not.toContain('stale refresh');
        expect(document.getElementById('summaryEmail')?.textContent).toContain('买家专属');
    });

    it('a cancelled query cannot reopen results or enable a newer request button', async () => {
        const { window, document, requests } = await portal();
        const first = window.doQuery('BUY-AAAA-BBBB');
        const next = window.doQuery('BUY-CCCC-DDDD');
        requests[0].resolve(result('old mailbox'));
        await first;
        expect((document.getElementById('queryBtn') as HTMLButtonElement).disabled).toBe(true);
        window.goBack();
        requests[1].resolve(result('late mailbox'));
        await next;
        expect(document.getElementById('resultSection')?.style.display).toBe('none');
        expect((document.getElementById('queryBtn') as HTMLButtonElement).disabled).toBe(false);
        await window.refreshCurrentQuery();
        expect(requests).toHaveLength(2);
    });

    it('filters by stable ID and preserves selection when refreshing duplicate masked addresses', async () => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('查询码：MSTR-AAAA-BBBB');
        requests[0].resolve(result('first mailbox'));
        await query;
        expect((document.getElementById('codeInput') as HTMLInputElement).value).toBe('MSTR-AAAA-BBBB');
        expect(document.getElementById('summaryEmail')?.textContent).toContain('主管理码');
        const select = document.getElementById('filterSelect') as HTMLSelectElement;
        select.value = 'v2';
        window.filterMails();
        expect(document.querySelectorAll('.mail-card')).toHaveLength(1);
        expect(document.getElementById('mailList')?.textContent).toContain('second mailbox');
        const refresh = window.refreshCurrentQuery();
        await window.refreshCurrentQuery();
        expect(requests).toHaveLength(2);
        requests[1].resolve(result('updated first mailbox'));
        await refresh;
        expect(select.value).toBe('v2');
        expect(document.querySelectorAll('.mail-card')).toHaveLength(1);
        expect(document.getElementById('mailList')?.textContent).not.toContain('updated first mailbox');
    });
});

describe('mail portal store configuration', () => {
    it.each([
        ['测试店铺甲', 'modern-oriental'],
        ['测试店铺乙', 'classic'],
    ])('uses the host-resolved configuration for %s', async (name, preset) => {
        const { document } = await portal({
            activeChannel: { id: 'store' },
            storefrontBranding: { name },
            storefrontVisualPreset: { channelId: 'store', presetId: preset },
        });
        expect(document.title).toBe('邮件验证码查询中心 - ' + name);
        expect(document.documentElement.dataset.storefrontPreset).toBe(preset);
        expect(document.querySelectorAll('[data-portal-store-name]')).toHaveLength(2);
        expect(document.body.textContent).not.toContain('MOYAO AI');
    });

    it.each([
        null,
        {
            activeChannel: { id: 'a' },
            storefrontBranding: { name: 'wrong store' },
            storefrontVisualPreset: { channelId: 'b', presetId: 'modern-oriental' },
        },
    ])('keeps neutral branding if store context cannot be verified', async data => {
        const { document } = await portal(data);
        expect(document.title).toBe('邮件验证码查询中心');
        expect(document.documentElement.dataset.storefrontPreset).toBeUndefined();
    });
});
