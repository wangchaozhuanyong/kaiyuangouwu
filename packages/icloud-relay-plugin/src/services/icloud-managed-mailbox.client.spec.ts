import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IcloudMailSanitizerService } from './icloud-mail-sanitizer.service';
import { IcloudManagedMailboxClient } from './icloud-managed-mailbox.client';
import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';

const { JSDOM } = createRequire(`${process.cwd()}/package.json`)('jsdom');
const endpoint = 'https://id.example.invalid/api/public/mailbox/query';
const code = 'AbCdEfGhJkMnPqRsTuV2';
const href =
    'https://shop.example.invalid/promo/account-entry?route=verify-account&token=synthetic%2Btoken&proof=synthetic.signature';
const mail = {
    from: 'Sender <sender@example.invalid>',
    to: 'buyer@example.invalid',
    subject: '验证电子邮箱',
    savedAt: '2026-10-26T07:18:50.000Z',
};
const client = (url = endpoint) =>
    new IcloudManagedMailboxClient(new IcloudMailSanitizerService(), new IcloudOtpExtractorService(), {
        managedMailboxQueryUrl: url,
    });
const envelope = (body: string) => ({ success: true, data: { email: mail.to, items: [{ ...mail, body }] } });
afterEach(() => vi.unstubAllGlobals());

describe('managed buyer-code mailbox bridge', () => {
    it.each([
        [
            'HTML button',
            `<p>请验证邮箱</p><a href="${href.replace(/&/g, '&amp;')}" style="background:green">验证电子邮箱</a>`,
        ],
        ['plain text', `验证电子邮箱\n[${href}]`],
    ])('keeps the exact signed address from %s without executing mail markup', async (_label, body) => {
        const request = vi.fn().mockResolvedValue(Response.json(envelope(body)));
        vi.stubGlobal('fetch', request);
        const result = await client().query(code);
        expect(result).toMatchObject({
            success: true,
            targetType: 'MANAGED',
            aliasEmail: mail.to,
            totalEmails: 1,
        });
        const init = request.mock.calls[0][1] as RequestInit;
        if (typeof init.body !== 'string') throw new Error('Expected a JSON request body');
        expect(JSON.parse(init.body)).toEqual({ queryCode: code, limit: 5 });
        expect(init).toMatchObject({
            method: 'POST',
            redirect: 'error',
            headers: { 'cache-control': 'no-store' },
        });
        expect(String(request.mock.calls[0][0])).toBe(endpoint);
        const dom = new JSDOM(result.items[0].bodyHtml);
        try {
            expect(dom.window.document.querySelector('a')?.getAttribute('href')).toBe(href);
            expect(dom.window.document.querySelector('a')?.getAttribute('target')).toBe('_blank');
            expect(result.items[0].bodyHtml).toContain("default-src 'none'");
            expect(result.items[0].receivedAt.toISOString()).toBe(mail.savedAt);
        } finally {
            dom.window.close();
        }
    });

    it('removes executable mail markup while retaining the safe button label and URL', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    Response.json(
                        envelope(
                            `<script>alert(1)</script><a onclick="alert(1)" href="${href.replace(/&/g, '&amp;')}">验证电子邮箱</a>`,
                        ),
                    ),
                ),
        );
        const result = await client().query(code);
        expect(result.items[0].bodyHtml).not.toMatch(/<script|onclick=/i);
        expect(result.items[0].bodyHtml).toContain('验证电子邮箱');
    });

    it.each([400, 429, 500])('handles upstream %s without disclosing its response body', async status => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response('private-upstream-detail', { status })),
        );
        const result = await client().query(code);
        expect(result.success).toBe(false);
        expect(result.items).toEqual([]);
        expect(result.message).not.toContain('private-upstream-detail');
        if (status === 429) expect(result.message).toContain('频繁');
        expect(result.retryAfterSeconds).toBeUndefined();
    });

    it.each(['24', 'Wed, 28 Oct 2026 08:00:24 GMT'])(
        'preserves the actual upstream cooldown from Retry-After: %s',
        async retryAfter => {
            const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T08:00:00Z'));
            try {
                vi.stubGlobal(
                    'fetch',
                    vi.fn().mockResolvedValue(
                        new Response('private-upstream-detail', {
                            status: 429,
                            headers: { 'retry-after': retryAfter },
                        }),
                    ),
                );
                expect(await client().query(code)).toMatchObject({
                    success: false,
                    retryAfterSeconds: 24,
                    message: '查询过于频繁，请 24 秒后再试。',
                });
            } finally {
                clock.mockRestore();
            }
        },
    );

    it.each(['', 'invalid', '-1', '0', '0.5', '2147483648', 'Wed, 01 Jan 2020 08:00:00 GMT'])(
        'does not invent a cooldown for unusable upstream Retry-After: %s',
        async retryAfter => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response('', {
                        status: 429,
                        headers: { 'retry-after': retryAfter },
                    }),
                ),
            );
            expect((await client().query(code)).retryAfterSeconds).toBeUndefined();
        },
    );

    it('only forwards cooldown metadata for an upstream rate-limit response', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('', {
                    status: 500,
                    headers: { 'retry-after': '24' },
                }),
            ),
        );
        expect((await client().query(code)).retryAfterSeconds).toBeUndefined();
    });

    it.each(['BUY-TEST-TEST', 'MSTR-TEST-TEST', 'bad code'])(
        'never forwards a local or invalid code',
        async value => {
            const request = vi.fn();
            vi.stubGlobal('fetch', request);
            expect((await client().query(value)).success).toBe(false);
            expect(request).not.toHaveBeenCalled();
        },
    );

    it.each([
        'http://id.example.invalid/api/public/mailbox/query',
        endpoint + '?key=fixture',
        'https://id.example.invalid/other',
    ])('rejects a misconfigured destination', async url => {
        const request = vi.fn();
        vi.stubGlobal('fetch', request);
        expect((await client(url).query(code)).success).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('bounds the response and rejects unexpected envelopes', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(
                new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'application/json' } }),
            )
            .mockResolvedValueOnce(Response.json({ success: true, data: { email: mail.to, items: [{}] } }));
        vi.stubGlobal('fetch', request);
        expect((await client().query(code)).success).toBe(false);
        expect((await client().query(code)).success).toBe(false);
    });

    it('returns a successful empty inbox without inventing mail', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(Response.json({ success: true, data: { email: mail.to, items: [] } })),
        );
        expect(await client().query(code)).toMatchObject({ success: true, items: [], totalEmails: 0 });
    });

    it('retains duplicate received messages with distinct stable viewer keys', async () => {
        const source = envelope('相同的收件正文');
        source.data.items.push({ ...source.data.items[0] });
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => Promise.resolve(Response.json(source))),
        );
        const first = await client().query(code);
        const second = await client().query(code);
        expect(first.items).toHaveLength(2);
        expect(new Set(first.items.map(item => item.id)).size).toBe(2);
        expect(second.items.map(item => item.id)).toEqual(first.items.map(item => item.id));
    });
});
