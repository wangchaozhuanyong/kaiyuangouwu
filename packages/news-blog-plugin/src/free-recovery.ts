import type { BlogRun } from './entities';

export const freeRecoveryLimit = 3;
export function runTelemetry(run: Pick<BlogRun, 'telemetryJson'>): Record<string, unknown> {
    return JSON.parse(run.telemetryJson || '{}');
}
export function isUnpaidFreeRun(run: BlogRun) {
    return (
        JSON.parse(run.inputJson).freeMode === true &&
        run.reservedMicros === 0 &&
        run.chargedMicros === 0 &&
        runTelemetry(run).providerAttempted !== true
    );
}
export function freeRecoveryCount(run: Pick<BlogRun, 'telemetryJson'>) {
    const count = runTelemetry(run).freeRecoveryCount;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
export function freeRecoveryDue(run: BlogRun, now = new Date()) {
    if (!isUnpaidFreeRun(run)) return false;
    const retryAfter = runTelemetry(run).retryAfter;
    if (run.state === 'DEFERRED')
        return (
            runTelemetry(run).freeQuotaPending === true &&
            typeof retryAfter === 'string' &&
            Date.parse(retryAfter) <= now.getTime()
        );
    if (freeRecoveryCount(run) >= freeRecoveryLimit) return false;
    if (run.state === 'RUNNING')
        return !!run.startedAt && now.getTime() - run.startedAt.getTime() > 30 * 60000;
    if (run.state === 'UNKNOWN') return true;
    // One safe recovery of legacy free failures; newly rejected evidence/configuration is never looped.
    return run.state === 'FAILED' && runTelemetry(run).freeRecoveryVersion !== 1;
}
export function nextFreeRecovery(run: BlogRun, now = new Date()) {
    const count = freeRecoveryCount(run);
    return {
        ...runTelemetry(run),
        mode: 'FREE_SOURCE',
        providerAttempted: false,
        externalModelCalls: 0,
        freeRecoveryVersion: 1,
        freeRecoveryCount: count + 1,
        freeQuotaPending: false,
        retryAfter: new Date(now.getTime() + [60000, 300000, 900000][Math.min(count, 2)]).toISOString(),
    };
}
