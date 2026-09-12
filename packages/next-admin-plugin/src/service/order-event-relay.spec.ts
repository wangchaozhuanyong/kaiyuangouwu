import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { listenForOrderEvents, orderEventSocketPath, relayOrderEvent } from './order-event-relay';

describe('API / worker event relay', () => {
    it('delivers from a separate OS process and acknowledges only after handling the event', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'order-relay-test-'));
        const socket = path.join(directory, 'events.sock');
        const received: Array<{ id: string; kind: string }> = [];
        const close = await listenForOrderEvents(socket, (id, kind) => {
            received.push({ id, kind });
            return Promise.resolve();
        });
        try {
            expect((await stat(socket)).mode % 0o1000).toBe(0o600);
            const script = `const s = require('node:net').createConnection(process.argv[1]);
                s.on('connect', () => s.write('worker-order\\n'));
                s.on('data', d => { if (d.toString().trim() !== 'ok') process.exitCode = 1; s.end(); });
                s.on('error', () => { process.exitCode = 1; });`;
            await promisify(execFile)(process.execPath, ['-e', script, socket]);
            expect(received).toEqual([{ id: 'worker-order', kind: 'placed' }]);
            await relayOrderEvent(socket, 'another-order');
            await relayOrderEvent(socket, 'worker-order', 'changed');
            expect(received).toEqual([
                { id: 'worker-order', kind: 'placed' },
                { id: 'another-order', kind: 'placed' },
                { id: 'worker-order', kind: 'changed' },
            ]);
        } finally {
            await close();
            await rm(directory, { recursive: true });
        }
    });
    it('does not replace a live listener and isolates runtime directories', async () => {
        expect(orderEventSocketPath('/runtime/one')).not.toBe(orderEventSocketPath('/runtime/two'));
        const directory = await mkdtemp(path.join(tmpdir(), 'order-relay-test-'));
        const socket = path.join(directory, 'events.sock');
        const close = await listenForOrderEvents(socket, () => Promise.resolve());
        try {
            await expect(listenForOrderEvents(socket, () => Promise.resolve())).rejects.toMatchObject({
                code: 'EADDRINUSE',
            });
        } finally {
            await close();
            await rm(directory, { recursive: true });
        }
    });
});
