import { fork } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TranslationProviderState } from './entities/translation-provider-state.entity.js';

// This suite is opt-in and hard-bound to the disposable loopback PostgreSQL fixture.
describe.runIf(process.env.TRANSLATION_TEST_POSTGRES === '1')('provider leases across OS processes', () => {
    let db: DataSource;
    beforeAll(async () => {
        db = await new DataSource({
            type: 'postgres',
            host: '127.0.0.1',
            port: 15492,
            username: 'postgres',
            database: 'translation_outbox_e2e',
            schema: 'outbox_process_test',
            entities: [TranslationProviderState],
        }).initialize();
        await db.query('CREATE SCHEMA IF NOT EXISTS outbox_process_test');
        await db.synchronize();
        await db.query(
            'CREATE TABLE IF NOT EXISTS outbox_process_test.provider_request (id serial PRIMARY KEY)',
        );
    });
    beforeEach(async () => {
        await db.getRepository(TranslationProviderState).clear();
        await db.query('TRUNCATE outbox_process_test.provider_request');
    });
    afterAll(async () => {
        await db?.destroy();
    });
    const worker = () => {
        const child = fork(path.join(__dirname, '../e2e/provider-process.mjs'), [], {
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        const messages: unknown[] = [];
        child.on('message', message => messages.push(message));
        return { child, messages, exited: once(child, 'exit') };
    };
    const count = async () =>
        Number((await db.query('SELECT count(*) FROM outbox_process_test.provider_request'))[0].count);
    it('allows only one external request when two independent worker processes contend', async () => {
        const first = worker();
        const second = worker();
        await Promise.all([first.exited, second.exited]);
        expect(await count()).toBe(1);
        expect([...first.messages, ...second.messages].sort()).toEqual([
            'BUSY',
            'completed',
            'provider-started',
        ]);
    }, 15_000);
    it('recovers an expired lease after the process dies during a provider request', async () => {
        const first = worker();
        await once(first.child, 'message');
        first.child.kill('SIGKILL');
        await first.exited;
        expect(await count()).toBe(1);
        const lease = await db
            .getRepository(TranslationProviderState)
            .findOneByOrFail({ provider: 'process-test' });
        await new Promise(resolve =>
            setTimeout(resolve, Math.max(0, (lease.leaseUntil?.getTime() ?? Date.now()) - Date.now()) + 50),
        );
        const restarted = worker();
        await restarted.exited;
        expect(await count()).toBe(2);
        expect(restarted.messages).toContain('completed');
    }, 45_000);
});
