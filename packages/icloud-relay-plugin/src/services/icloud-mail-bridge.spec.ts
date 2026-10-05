import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { IcloudMailBridge, MailChange } from './icloud-mail-bridge';

const require = createRequire(import.meta.url);
describe('same-host mail notification bridge', () => {
    it('broadcasts from another Node process, buffers startup, and elects a replacement after broker shutdown', async () => {
        // Native short-lived socket paths are required by the Unix socket length limit.
        const directory = await mkdtemp(join(tmpdir(), 'vmail-test-'));
        const path = join(directory, 'bus.sock');
        const messages: MailChange[] = [];
        const broker = new IcloudMailBridge(
            'fixture',
            event => messages.push(event),
            () => undefined,
            path,
        );
        broker.start();
        const source = resolve('src/services/icloud-mail-bridge.ts');
        const child = spawn(
            process.execPath,
            [
                '-r',
                require.resolve('ts-node/register/transpile-only'),
                '-e',
                `
            const { IcloudMailBridge } = require(${JSON.stringify(source)});
            const bridge = new IcloudMailBridge('fixture', event => process.send(event), () => {}, ${JSON.stringify(path)});
            bridge.start();
            bridge.publish({kind:'mail',eventId:'child-startup',cursor:'1',primaryAccountId:'1',virtualEmailId:'2'});
            process.on('message', event => bridge.publish(event));
        `,
            ],
            {
                cwd: resolve('.'),
                stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
                env: {
                    ...process.env,
                    TS_NODE_SKIP_PROJECT: 'true',
                    TS_NODE_COMPILER_OPTIONS: JSON.stringify({
                        module: 'CommonJS',
                        moduleResolution: 'Node',
                        target: 'ES2017',
                    }),
                },
            },
        );
        const childMessages: MailChange[] = [];
        child.on('message', message => childMessages.push(message as MailChange));
        let errors = '';
        child.stderr?.on('data', chunk => {
            errors += chunk.toString();
        });
        let reader: IcloudMailBridge | undefined;
        try {
            await expect
                .poll(() => messages.some(event => event.eventId === 'child-startup'), { timeout: 6000 })
                .toBe(true);
            expect(errors).toBe('');
            await broker.stop();
            const recovered: MailChange[] = [];
            reader = new IcloudMailBridge(
                'fixture',
                event => recovered.push(event),
                () => undefined,
                path,
            );
            reader.start();
            child.send({
                kind: 'mail',
                eventId: 'after-broker-restart',
                cursor: '2',
                primaryAccountId: '1',
                virtualEmailId: '2',
            });
            await expect
                .poll(() => recovered.some(event => event.eventId === 'after-broker-restart'), {
                    timeout: 6000,
                })
                .toBe(true);
            expect(childMessages.some(event => event.eventId === 'after-broker-restart')).toBe(true);
            child.kill();
            await expect
                .poll(() => recovered.some(event => event.kind === 'access'), { timeout: 3000 })
                .toBe(true);
        } finally {
            child.kill();
            await reader?.stop();
            await broker.stop();
            await rm(directory, { recursive: true, force: true });
        }
    }, 15_000);
});
