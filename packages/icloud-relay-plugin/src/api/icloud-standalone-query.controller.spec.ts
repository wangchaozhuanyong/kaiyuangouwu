import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { IcloudStandaloneQueryController } from './icloud-standalone-query.controller';

function fixture() {
    const ctx = {};
    const context = { create: vi.fn().mockResolvedValue(ctx) };
    const result = { success: true, items: [], totalEmails: 0 };
    const queries = { queryByCode: vi.fn().mockResolvedValue(result) };
    type Dependencies = ConstructorParameters<typeof IcloudStandaloneQueryController>;
    const controller = new IcloudStandaloneQueryController(
        context as unknown as Dependencies[0],
        queries as unknown as Dependencies[1],
    );
    const req = { ip: '192.0.2.1', get: vi.fn().mockReturnValue('test-agent') } as unknown as Request;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const query = (body: unknown) => controller.query(body, req, res as unknown as Response);
    return { context, queries, ctx, res, req, query, result };
}

describe('standalone mail lookup', () => {
    it.each(['BUY-TEST-0001', 'CaseSensitiveFixture'])(
        'uses the original unified lookup for %s',
        async code => {
            const f = fixture();
            await f.query({ queryCode: code });
            expect(f.context.create).toHaveBeenCalledWith({ apiType: 'shop' });
            expect(f.queries.queryByCode).toHaveBeenCalledWith(f.ctx, code, '192.0.2.1', 'test-agent');
            expect(f.res.json).toHaveBeenCalledWith(f.result);
            expect(f.res.status).toHaveBeenCalledWith(200);
            expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, no-transform');
        },
    );
    it.each([null, {}, { queryCode: 42 }, { queryCode: ' ' }, { queryCode: 'a'.repeat(129) }])(
        'rejects malformed inputs before querying',
        async body => {
            const f = fixture();
            await f.query(body);
            expect(f.res.status).toHaveBeenCalledWith(400);
            expect(f.queries.queryByCode).not.toHaveBeenCalled();
        },
    );
    it('does not turn backend failures into an empty mailbox or expose diagnostics', async () => {
        const f = fixture();
        f.queries.queryByCode.mockRejectedValue(new Error('internal diagnostic'));
        await f.query({ queryCode: 'BUY-TEST-0001' });
        expect(f.res.status).toHaveBeenCalledWith(503);
        expect(f.res.json).toHaveBeenCalledWith({ error: 'mail_query_unavailable' });
    });
});
