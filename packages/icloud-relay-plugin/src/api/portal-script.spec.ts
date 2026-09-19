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
    const requests: Array<{
        signal: AbortSignal;
        resolve: (data: unknown) => void;
        respond: (response: Response) => void;
        reject: (error: Error) => void;
    }> = [];
    dom.window.fetch = vi.fn((_url, init) => {
        if (JSON.parse(String(init?.body)).query.includes('MailPortalBranding')) {
            return Promise.resolve(Response.json({ data: branding }));
        }
        return new Promise<Response>((resolve, reject) =>
            requests.push({
                signal: init?.signal as AbortSignal,
                resolve: data => resolve(Response.json({ data: { icloudQueryMails: data } })),
                respond: resolve,
                reject,
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

describe('mail portal failure feedback', () => {
    it.each([
        [
            Response.json({
                data: null,
                errors: [{ message: 'private detail', extensions: { code: 'FORBIDDEN' } }],
            }),
            '邮件查询暂时无法访问',
        ],
        [Response.json({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] }), '邮件查询暂时无法访问'],
        [new Response('', { status: 403 }), '邮件查询暂时无法访问'],
        [new Response('', { status: 502 }), '邮件服务暂时不可用'],
        [Response.json({ errors: [{ message: 'private detail' }] }), '邮件服务暂时不可用'],
        [Response.json({ data: null }), '邮件服务暂时不可用'],
        [new Response('<html>Bad gateway</html>'), '邮件服务暂时不可用'],
    ])('does not describe an API failure as an invalid code', async (response, expected) => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('MSTR-TEST-TEST');
        requests[0].respond(response);
        await query;
        expect(document.getElementById('msgBox')?.textContent).toContain(expected);
        expect(document.getElementById('msgBox')?.textContent).not.toMatch(
            /未找到匹配|无效的查询码|private detail/,
        );
        expect((document.getElementById('queryBtn') as HTMLButtonElement).disabled).toBe(false);
    });

    it.each([
        '该主查询码已过期，请联系管理员。',
        '无效的查询码，请检查后重试。',
        '查询过于频繁，请 15 分钟后再试。',
        '<img src=x onerror=alert(1)>',
    ])('preserves and safely renders the business rejection: %s', async message => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('MSTR-TEST-TEST');
        requests[0].resolve({ success: false, message, items: [], totalEmails: 0 });
        await query;
        expect(document.getElementById('msgBox')?.textContent).toContain(message);
        expect(document.querySelector('#msgBox img')).toBeNull();
    });

    it('shows a network failure and keeps the code available for retry', async () => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('MSTR-TEST-TEST');
        requests[0].reject(new TypeError('Failed to fetch'));
        await query;
        expect(document.getElementById('msgBox')?.textContent).toContain('网络连接失败');
        expect((document.getElementById('codeInput') as HTMLInputElement).value).toBe('MSTR-TEST-TEST');
    });

    it('keeps the previous mail list visible on a failed refresh, then clears the error on recovery', async () => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('MSTR-TEST-TEST');
        requests[0].resolve(result('previous mail'));
        await query;
        const refresh = window.refreshCurrentQuery();
        requests[1].respond(Response.json({ errors: [{ extensions: { code: 'FORBIDDEN' } }] }));
        await refresh;
        expect(document.getElementById('mailList')?.textContent).toContain('previous mail');
        expect(document.getElementById('refreshStatus')?.textContent).toContain('邮件查询暂时无法访问');
        expect(document.getElementById('refreshStatus')?.style.display).not.toBe('none');
        const retry = window.refreshCurrentQuery();
        requests[2].resolve(result('new mail'));
        await retry;
        expect(document.getElementById('mailList')?.textContent).toContain('new mail');
        expect(document.getElementById('refreshStatus')?.textContent).toBe('');
    });
});

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
    it('ships neutral server HTML before host branding is resolved', () => {
        expect(PORTAL_HTML).not.toContain('大马通');
        expect(PORTAL_HTML.match(/data-portal-store-name/g)).toHaveLength(2);
        expect(PORTAL_HTML).toContain('<span data-portal-store-name>店铺</span>');
    });

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

describe('buyer recent mail display and error states', () => {
    it('replaces the five visible mails on refresh and shows an accurate limit label', async () => {
        const { window, document, requests } = await portal();
        const mailResult = (start: number) => ({
            ...result('buyer', 'VIRTUAL'),
            totalEmails: 5,
            virtualEmailsList: [],
            items: Array.from({ length: 5 }, (_, index) => ({
                id: String(start - index),
                subject: 'Mail-' + (start - index),
                fromAddress: 'fixture@example.com',
                bodyText: 'Fixture body',
            })),
        });
        const query = window.doQuery('BUY-TEST-MAIL');
        requests[0].resolve(mailResult(5));
        await query;
        expect(document.querySelectorAll('.mail-card')).toHaveLength(5);
        expect(document.getElementById('totalMailCount')?.textContent).toBe('最近 5 封邮件，最多显示 5 封');
        const refresh = window.refreshCurrentQuery();
        requests[1].resolve(mailResult(6));
        await refresh;
        expect(document.querySelectorAll('.mail-card')).toHaveLength(5);
        expect(document.getElementById('mailList')?.textContent).toContain('Mail-6');
        expect(document.getElementById('mailList')?.textContent).not.toContain('Mail-1');
        (document.querySelector('.toggle-body-btn') as HTMLButtonElement).click();
        expect(document.querySelector('.mail-card.open')).not.toBeNull();
    });
    it('keeps the previous result with a visible refresh error rather than showing zero', async () => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('BUY-TEST-MAIL');
        requests[0].resolve(result('retained mail', 'VIRTUAL'));
        await query;
        const refresh = window.refreshCurrentQuery();
        requests[1].resolve({ success: false, message: '服务暂时不可用' });
        await refresh;
        expect(document.getElementById('mailList')?.textContent).toContain('retained mail');
        expect(document.getElementById('refreshStatus')?.textContent).toContain('服务暂时不可用');
        expect(document.getElementById('refreshStatus')?.className).toContain('error');
    });
    it('does not promise active listening for an empty result', async () => {
        const { window, document, requests } = await portal();
        const query = window.doQuery('BUY-TEST-MAIL');
        requests[0].resolve({ ...result('', 'VIRTUAL'), items: [], totalEmails: 0 });
        await query;
        expect(document.getElementById('mailList')?.textContent).toContain('暂未查询到此邮箱的邮件');
        expect(document.body.textContent).not.toContain('实时监听状态');
    });
});
