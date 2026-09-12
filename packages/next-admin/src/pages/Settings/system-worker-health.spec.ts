import { describe, expect, it } from 'vitest';
import type { SettingsStoreFieldRecord } from '../../graphql/management.graphql';

import { getSystemWorkerHealth } from './system-worker-health';

const now = Date.parse('2026-09-09T15:00:00Z');
const record = {
    state: 'RUNNING',
    heartbeatAt: new Date(now).toISOString(),
    queues: [{ name: 'mail', running: true }],
};
function status(value: unknown) {
    return getSystemWorkerHealth(
        [{ key: 'systemOperations.workerHeartbeat', currentValue: value } as SettingsStoreFieldRecord],
        now,
    );
}
describe('worker health display', () => {
    it('shows fresh independent worker status instead of API-local queue flags', () => {
        expect(status(record)).toMatchObject({ label: '运行中', tone: 'green' });
    });
    it.each([undefined, {}, { ...record, heartbeatAt: 'invalid' }, { ...record, queues: [{}] }])(
        'does not invent health for invalid/missing data',
        value => {
            expect(status(value)).toMatchObject({ label: '未接收到心跳', tone: 'slate' });
        },
    );
    it('marks a stopped worker and an expired heartbeat as failures', () => {
        expect(status({ ...record, state: 'STOPPED' }).label).toBe('已停止');
        expect(status({ ...record, heartbeatAt: new Date(now - 60_001).toISOString() }).label).toBe(
            '心跳超时',
        );
    });
    it('reports startup and individual stopped queues accurately', () => {
        expect(status({ ...record, queues: [] }).label).toBe('正在启动');
        expect(status({ ...record, queues: [{ name: 'mail', running: false }] })).toMatchObject({
            label: '部分队列未启动',
            detail: 'mail',
        });
    });
});
