// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { standaloneMailQueryApi } from './standalone-mail-query';

afterEach(() => vi.unstubAllGlobals());
describe('standalone mail transport', () => {
    it('sends the case-sensitive query code only in a same-origin POST body without customer credentials', async () => {
        const data = { success: true, items: [] };
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(data) });
        vi.stubGlobal('fetch', fetcher);
        expect(await standaloneMailQueryApi.queryMails('CaseSensitiveFixture')).toEqual(data);
        expect(fetcher).toHaveBeenCalledWith(
            '/api/mail/query',
            expect.objectContaining({
                method: 'POST',
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'error',
                referrerPolicy: 'no-referrer',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queryCode: 'CaseSensitiveFixture' }),
            }),
        );
    });
    it('reports HTTP failures rather than displaying an empty successful result', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        await expect(standaloneMailQueryApi.queryMails('fixture')).rejects.toThrow('Mail query unavailable');
    });
});
