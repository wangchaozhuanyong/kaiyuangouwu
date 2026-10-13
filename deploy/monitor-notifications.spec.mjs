import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    certificateSignal,
    deliverSignals,
    externalSignal,
    hostSignals,
    notificationChannelStatus,
    publicSignals,
} from './monitor-notifications.mjs';
import { loadProductionStorefronts } from './production-storefronts.mjs';
describe('Chinese persisted external monitoring', () => {
    it('distinguishes confirmed server checks from an unavailable inspection', () => {
        assert.equal(externalSignal({ Status: 'TimedOut' }).monitor, true);
        assert.equal(
            externalSignal({
                Status: 'Failed',
                Error: 'Production health monitor failed: process unavailable',
            }).monitor,
            false,
        );
        assert.equal(externalSignal({ Status: 'Success' }).firing, false);
    });
    it('notifies certificate thresholds, invalidity, expiry and replacement', () => {
        const now = new Date('2026-10-02T00:00:00Z');
        for (const day of [14, 7, 3]) {
            const signal = certificateSignal(
                'shop.example',
                { valid_to: new Date(now.getTime() + day * 86400000).toISOString(), authorized: true },
                now,
            );
            assert.equal(signal.firing, true);
            assert.match(signal.reason, new RegExp(`不足 ${day} 天`));
        }
        assert.equal(
            certificateSignal('shop.example', { valid_to: now.toISOString(), authorized: true }, now)
                .severity,
            'P0',
        );
        assert.equal(
            certificateSignal(
                'shop.example',
                { valid_to: new Date(now.getTime() + 30 * 86400000).toISOString(), authorized: true },
                now,
            ).firing,
            false,
        );
    });
    it('persists deduplication, repeats critical after thirty minutes, and sends one recovery', async () => {
        const calls = [];
        const send = async text => {
            calls.push(text);
        };
        const incident = {
            key: 'host:test',
            severity: 'P0',
            firing: true,
            reason: '数据库连接中断',
            samples: 2,
        };
        let result = await deliverSignals([incident], {}, send, 1000);
        assert.equal(calls.length, 0);
        result = await deliverSignals([incident], result.state, send, 2000);
        assert.equal(calls.length, 1);
        result = await deliverSignals([incident], result.state, send, 3000);
        assert.equal(calls.length, 1);
        result = await deliverSignals([incident], result.state, send, 1802000);
        assert.equal(calls.length, 2);
        result = await deliverSignals([{ ...incident, firing: false }], result.state, send, 1803000);
        assert.equal(calls.length, 3);
        await deliverSignals([{ ...incident, firing: false }], result.state, send, 1804000);
        assert.equal(calls.length, 3);
        assert.match(calls[2], /恢复/);
    });
    it('keeps failed sends eligible for retry and never says a failed inspection proves a host outage', async () => {
        const incident = externalSignal(null);
        const failed = await deliverSignals(
            [incident],
            {},
            async () => {
                throw new Error('transport private data');
            },
            1000,
        );
        assert.equal(failed.state[incident.key].active, false);
        assert.equal(failed.failed, 1);
        assert.equal(failed.sent, 0);
        const messages = [];
        await deliverSignals([incident], failed.state, async text => messages.push(text), 2000, {
            external: true,
        });
        assert.match(messages[0], /尚未确认服务器故障/);
        assert.match(messages[0], /调度可能延迟/);
        assert.doesNotMatch(messages[0], /transport private data/);
    });
    it('registers backup, restore, disk and database checks using the existing failure codes', () => {
        const signals = hostSignals(['backup-checksum-invalid', 'root-disk-high']);
        assert.equal(signals.filter(signal => signal.firing).length, 2);
        assert.equal(signals.find(signal => signal.key === 'host:mysql-unreachable').samples, 2);
    });
    it('covers every direct and prefixed failure emitted by the production health service', async () => {
        const healthcheck = await readFile(
            new URL('./systemd/vendure-production-healthcheck', import.meta.url),
            'utf8',
        );
        const codes = new Set(
            [...healthcheck.matchAll(/failures\+=\("([a-z-]+)"\)/gu)].map(match => match[1]),
        );
        for (const [functionName, prefixes] of [
            ['check_backup', ['backup', 'file-backup']],
            ['check_restore_evidence', ['restore-drill', 'file-restore-drill']],
        ]) {
            const body = healthcheck.split(`${functionName}() {`)[1].split('\n}')[0];
            for (const match of body.matchAll(/failures\+=\("\$\{failure_prefix\}(-[a-z-]+)"\)/gu)) {
                for (const prefix of prefixes) {
                    if (match[1] === '-full-restore-unverified' && prefix !== 'file-restore-drill') continue;
                    codes.add(`${prefix}${match[1]}`);
                }
            }
        }
        assert.equal(codes.size, 17);
        const signals = hostSignals([...codes]);
        assert.deepEqual(new Set(signals.map(signal => signal.key.replace('host:', ''))), codes);
        assert.ok(signals.every(signal => signal.firing));
    });
    it('sends each backup and restore failure once and one recovery after successful delivery', async () => {
        const codes = hostSignals([])
            .map(signal => signal.key.replace('host:', ''))
            .filter(code => /backup|restore-drill/u.test(code));
        const messages = [];
        const send = async text => messages.push(text);
        const incident = await deliverSignals(hostSignals(codes), {}, send, 1_000);
        assert.equal(incident.sent, 13);
        assert.equal(incident.failed, 0);
        const repeated = await deliverSignals(hostSignals(codes), incident.state, send, 2_000);
        assert.equal(repeated.sent, 0);
        const recovered = await deliverSignals(hostSignals([]), repeated.state, send, 3_000);
        assert.equal(recovered.sent, 13);
        assert.ok(messages.slice(13).every(text => /系统监测恢复/u.test(text)));
        const settled = await deliverSignals(hostSignals([]), recovered.state, send, 4_000);
        assert.equal(settled.sent, 0);
        assert.equal(messages.length, 26);
    });
    it('reports configuration readiness without exposing credentials or treating missing fields as success', () => {
        const configured = {
            enabled: true,
            notifySecurityEvents: true,
            chatId: 'fixture-destination',
        };
        assert.equal(notificationChannelStatus(configured, 'fixture-token').ready, true);
        for (const change of [
            { enabled: false },
            { notifySecurityEvents: false },
            { chatId: '' },
            { chatId: ' ' },
        ]) {
            assert.equal(
                notificationChannelStatus({ ...configured, ...change }, 'fixture-token').ready,
                false,
            );
        }
        for (const token of [undefined, '', ' ']) {
            assert.equal(notificationChannelStatus(configured, token).ready, false);
        }
        assert.doesNotMatch(
            JSON.stringify(notificationChannelStatus(configured, 'fixture-token')),
            /fixture-token|fixture-destination/u,
        );
    });
    it('fails the command before network probes when no notification channel is configured', () => {
        const result = spawnSync(
            process.execPath,
            [fileURLToPath(new URL('./monitor-notifications.mjs', import.meta.url))],
            {
                env: {},
                encoding: 'utf8',
                timeout: 5_000,
            },
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /MONITOR_NOTIFICATION_CHANNEL_UNAVAILABLE/u);
        assert.match(result.stderr, /"ready":false/u);
        assert.doesNotMatch(result.stdout, /成功发送/u);
    });
    it('probes every production storefront and emits a dedicated third-store outage signal', async () => {
        const config = await loadProductionStorefronts();
        const requests = [];
        const signals = await publicSignals(config, {
            fetchImpl: async url => {
                requests.push(String(url));
                const failed = url.hostname === 'shop.flashcast.com.my';
                return new Response(JSON.stringify({ status: failed ? 'error' : 'ok' }), {
                    status: failed ? 503 : 200,
                });
            },
            certificateReader: async () => ({
                valid_to: new Date(Date.now() + 30 * 86_400_000).toISOString(),
                authorized: true,
            }),
        });
        assert.ok(requests.includes('https://shop.flashcast.com.my/health'));
        assert.equal(
            signals.find(signal => signal.key === 'public:https://shop.flashcast.com.my:/health')?.firing,
            true,
        );
        assert.equal(
            signals.filter(signal => signal.key.startsWith('public:')).length,
            config.storefronts.length + 1,
        );
    });
});
