import type { ImageAdminConfigRecord, ImageAdminModelRecord } from './dashboard/image-generation.graphql';

export function toLocalDayBoundary(value: string, endOfDay: boolean): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const boundary = new Date(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
    );
    if (boundary.getFullYear() !== year || boundary.getMonth() !== month - 1 || boundary.getDate() !== day) {
        return null;
    }
    return boundary.toISOString();
}

export function reconcileImageAdminConfig(
    current: ImageAdminConfigRecord | null,
    baseline: ImageAdminConfigRecord | null,
    incoming: ImageAdminConfigRecord,
): ImageAdminConfigRecord {
    if (!current || !baseline) return structuredClone(incoming);
    const next = reconcileRecord(current, baseline, incoming);
    const currentModels = new Map(current.models.map(model => [model.code, model]));
    const baselineModels = new Map(baseline.models.map(model => [model.code, model]));
    next.models = incoming.models.map(model => {
        const currentModel = currentModels.get(model.code);
        const baselineModel = baselineModels.get(model.code);
        return currentModel && baselineModel
            ? reconcileRecord(currentModel, baselineModel, model)
            : structuredClone(model);
    });
    return next;
}

export function reconcileRecord<T extends object>(current: T, baseline: T, incoming: T): T {
    const result = structuredClone(incoming) as Record<string, unknown>;
    for (const key of Object.keys(incoming)) {
        if (key === 'models') continue;
        const currentValue = (current as Record<string, unknown>)[key];
        const baselineValue = (baseline as Record<string, unknown>)[key];
        if (!sameValue(currentValue, baselineValue)) result[key] = structuredClone(currentValue);
    }
    return result as T;
}

export function replaceAdminModel(
    config: ImageAdminConfigRecord,
    savedModel: ImageAdminModelRecord,
): ImageAdminConfigRecord {
    return {
        ...config,
        models: config.models.map(model =>
            model.code === savedModel.code ? structuredClone(savedModel) : model,
        ),
    };
}

export function sameAdminConfig(
    left: ImageAdminConfigRecord | null,
    right: ImageAdminConfigRecord | null,
): boolean {
    return sameValue(left, right);
}

export function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function modelInput(model: ImageAdminModelRecord) {
    const {
        id: _id,
        officialModelId: _official,
        healthStatus: _health,
        healthMessage: _healthMessage,
        lastTestedAt: _lastTestedAt,
        resolutionOptions: _resolutionOptions,
        ...input
    } = model;
    return input;
}

export function protocolChange(model: ImageAdminModelRecord, value: string): Partial<ImageAdminModelRecord> {
    const protocol = value as ImageAdminModelRecord['protocol'];
    const changed = { ...model, protocol };
    return {
        protocol,
        unitPrice2K: modelSupportsResolution(changed, '2K') ? model.unitPrice2K : 0,
        unitPrice4K: modelSupportsResolution(changed, '4K') ? model.unitPrice4K : 0,
    };
}

export function modelSupportsResolution(
    model: Pick<ImageAdminModelRecord, 'officialModelId' | 'providerModelId' | 'protocol'>,
    resolution: '1K' | '2K' | '4K',
) {
    if (resolution === '1K') return true;
    const official = model.officialModelId.replace(/^models\//iu, '').toLowerCase();
    const provider = model.providerModelId.replace(/^models\//iu, '').toLowerCase();
    const geminiNative = ['GEMINI_INTERACTIONS', 'GEMINI_NATIVE', 'GEMINI_NATIVE_STREAM'].includes(
        model.protocol,
    );
    if (geminiNative && /^(?:gemini-3(?:\.\d+)?-(?:pro|flash)-image)(?:-|$)/u.test(official)) {
        return true;
    }
    return (
        ['OPENAI_IMAGES', 'OPENAI_RESPONSES_IMAGE'].includes(model.protocol) &&
        (official === 'gpt-image-2' || provider === 'gpt-image-2')
    );
}

export function currencyFactor(currency: string) {
    return ['JPY', 'KRW', 'VND'].includes(currency) ? 1 : 100;
}

export function minorToMajor(value: number, currency: string) {
    return String(value / currencyFactor(currency));
}

export function majorToMinor(value: string, currency: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * currencyFactor(currency)) : 0;
}

export function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
