import { mergeConfig, RequestContext, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { IcloudMailOutbox } from '../src/entities/icloud-mail-outbox.entity';
import { IcloudVirtualEmail } from '../src/entities/icloud-virtual-email.entity';
import { IcloudRelayPlugin } from '../src/icloud-relay.plugin';
import { IcloudJobService } from '../src/jobs/icloud-job.service';
import { IcloudAdminService } from '../src/services/icloud-admin.service';
import { IcloudIdleService } from '../src/services/icloud-idle.service';
import { IcloudStorefrontEventsService } from '../src/services/icloud-storefront-events.service';

describe('storefront mail HTTP subscription', () => {
    const port = 33559;
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: { port },
            plugins: [IcloudRelayPlugin.init({ realtimeEnabled: true })],
        }),
    );
    const idleBootstrap = vi
        .spyOn(IcloudIdleService.prototype, 'onApplicationBootstrap')
        .mockResolvedValue(undefined);
    const idleReconcile = vi
        .spyOn(IcloudIdleService.prototype, 'reconcile')
        .mockImplementation(() => undefined);
    const jobs = vi.spyOn(IcloudJobService.prototype, 'onModuleInit').mockImplementation(() => undefined);
    let connection: TransactionalConnection;
    let buyer: { id: string | number; buyerQueryCode: string };
    let other: { id: string | number; buyerQueryCode: string };
    let primaryId: string;
    const ctx = RequestContext.empty();
    const url = `http://127.0.0.1:${port}/storefront-realtime/mail-events`;
    beforeAll(async () => {
        const runtime = resolve(__dirname, '../../../.runtime/storefront-mail-events-e2e');
        mkdirSync(runtime, { recursive: true });
        registerInitializer('sqljs', new SqljsInitializer(mkdtempSync(`${runtime}/run-`)));
        await server.init({ initialData });
        connection = server.app.get(TransactionalConnection);
        const admin = server.app.get(IcloudAdminService);
        const primary = await admin.createPrimaryAccount(ctx, {
            email: 'synthetic-mail@icloud.com',
            appPassword: 'isolated-local-fixture',
        });
        primaryId = String(primary.id);
        buyer = await admin.createVirtualEmail(ctx, {
            primaryAccountId: primary.id,
            aliasEmail: 'alias-one@example.test',
        });
        other = await admin.createVirtualEmail(ctx, {
            primaryAccountId: primary.id,
            aliasEmail: 'alias-two@example.test',
        });
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(async () => {
        await server.destroy();
        idleBootstrap.mockRestore();
        idleReconcile.mockRestore();
        jobs.mockRestore();
    });

    async function open(code: string, signal: AbortSignal, cursor?: string) {
        return fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ queryCode: code, cursor }),
            signal,
        });
    }
    async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
        const chunk = await reader.read();
        return chunk.done ? '' : new TextDecoder().decode(chunk.value);
    }
    async function insert(eventId: string, virtualEmailId: string, rollback = false) {
        await connection.withTransaction(ctx, async tx => {
            await connection.getRepository(tx, IcloudMailOutbox).save(
                new IcloudMailOutbox({
                    eventId,
                    primaryAccountId: primaryId,
                    virtualEmailId,
                    deliveredAt: null,
                }),
            );
            if (rollback) throw new Error('synthetic rollback');
        });
    }

    it('registers the real Nest route and emits only committed notifications in the authorized buyer scope', async () => {
        await expect
            .poll(() => server.app.get(IcloudStorefrontEventsService).isReady, { timeout: 3000 })
            .toBe(true);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await open(buyer.buyerQueryCode, controller.signal);
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toContain('no-store');
            if (!response.body) throw new Error('Missing stream body');
            const reader = response.body.getReader();
            const ready = await read(reader);
            expect(ready).toContain('event: ready');
            await expect(insert('rolled-back', String(buyer.id), true)).rejects.toThrow('synthetic rollback');
            await insert('other-buyer', String(other.id));
            await insert('committed-buyer', String(buyer.id));
            const frame = await read(reader);
            expect(frame).toContain('committed-buyer');
            expect(frame).not.toMatch(/rolled-back|other-buyer|BUY-|bodyText|extractedCode/);
            const outbox = await connection
                .getRepository(ctx, IcloudMailOutbox)
                .findOneByOrFail({ eventId: 'committed-buyer' });
            expect(outbox.deliveredAt).toBeNull();
            await reader.cancel();
        } finally {
            controller.abort();
            clearTimeout(timeout);
        }
    });

    it('recovers committed history after reconnect and closes on query-code revocation', async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await open(buyer.buyerQueryCode, controller.signal, '0');
            expect(response.status).toBe(200);
            if (!response.body) throw new Error('Missing stream body');
            const reader = response.body.getReader();
            expect(await read(reader)).toContain('"recovered":true');
            await connection
                .getRepository(ctx, IcloudVirtualEmail)
                .update({ id: buyer.id }, { status: 'DISABLED' as never });
            expect(await read(reader)).toContain('event: access-denied');
            expect((await reader.read()).done).toBe(true);
        } finally {
            controller.abort();
            clearTimeout(timeout);
        }
    });

    it('rejects the disabled code and invalid codes on the same public authorization boundary', async () => {
        const controller = new AbortController();
        const disabled = await open(buyer.buyerQueryCode, controller.signal);
        expect(disabled.status).toBe(403);
        await disabled.body?.cancel();
        const invalid = await open('BUY-XXXX-XXXX', controller.signal);
        expect(invalid.status).toBe(403);
        await invalid.body?.cancel();
        controller.abort();
    });
});
