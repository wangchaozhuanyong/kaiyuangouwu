import type { SettingsStoreFieldRecord } from '../../graphql/management.graphql';

export function getSystemWorkerHealth(fields: SettingsStoreFieldRecord[], now = Date.now()) {
    const value = fields.find(field => field.key === 'systemOperations.workerHeartbeat')?.currentValue;
    const unknown = { label: '未接收到心跳', detail: '等待后台任务服务上报运行状态', tone: 'slate' as const };
    if (!value || typeof value !== 'object') return unknown;
    const record = value as Record<string, unknown>;
    const heartbeat = typeof record.heartbeatAt === 'string' ? Date.parse(record.heartbeatAt) : NaN;
    if (!Number.isFinite(heartbeat) || heartbeat > now + 5_000) return unknown;
    if (record.state === 'STOPPED') {
        return { label: '已停止', detail: '后台任务服务已上报停止状态', tone: 'rose' as const };
    }
    if (now - heartbeat > 60_000) {
        return { label: '心跳超时', detail: '超过 60 秒未收到后台任务服务心跳', tone: 'rose' as const };
    }
    if (record.state !== 'RUNNING' || !Array.isArray(record.queues)) return unknown;
    if (
        !record.queues.every(
            queue => queue && typeof queue.name === 'string' && typeof queue.running === 'boolean',
        )
    )
        return unknown;
    const queues = record.queues as Array<{ name: string; running: boolean }>;
    if (!queues.length)
        return { label: '正在启动', detail: '已收到心跳，等待任务队列启动', tone: 'amber' as const };
    const stopped = queues.filter(queue => !queue.running);
    return stopped.length
        ? {
              label: '部分队列未启动',
              detail: stopped.map(queue => queue.name).join('、'),
              tone: 'amber' as const,
          }
        : { label: '运行中', detail: `${queues.length} 个队列运行中，心跳正常`, tone: 'green' as const };
}
