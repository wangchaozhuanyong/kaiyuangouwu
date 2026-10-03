import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { certificateSignal, deliverSignals, externalSignal, hostSignals } from './monitor-notifications.mjs';
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
});
