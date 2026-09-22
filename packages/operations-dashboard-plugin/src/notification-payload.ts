const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|credential|private.?key|api.?key/iu;

export function sanitizePayload(input: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(input).slice(0, 40)) {
        const key = boundedText(rawKey, 64);
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        output[key] = sanitizeValue(key, rawValue, false, 0);
    }
    return output;
}

export function sanitizeIncidentEvidence(input: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(input).slice(0, 40)) {
        const key = boundedText(rawKey, 64);
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        output[key] = sanitizeValue(key, rawValue, true, 0);
    }
    return output;
}

function sanitizeValue(key: string, value: unknown, nested: boolean, depth: number): unknown {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
        return value.slice(0, 20).map(item => sanitizeValue(key, item, nested, depth + 1));
    }
    if (typeof value === 'object') {
        if (!nested || depth >= 3) return '[object omitted]';
        const output: Record<string, unknown> = {};
        for (const [childKeyValue, childValue] of Object.entries(value).slice(0, 40)) {
            const childKey = boundedText(childKeyValue, 64);
            if (SENSITIVE_KEY_PATTERN.test(childKey)) continue;
            output[childKey] = sanitizeValue(childKey, childValue, true, depth + 1);
        }
        return output;
    }
    if (typeof value !== 'string') return `[${typeof value} omitted]`;
    let text = value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    text = text
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, match => maskEmail(match))
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/gu, match => maskIp(match));
    if (/email/iu.test(key) && !text.includes('***@')) text = maskEmail(text);
    if (/ip/iu.test(key) && !text.includes('.x.x')) text = maskIp(text);
    return text.slice(0, /error|message|reason|note|summary|cause|impact/iu.test(key) ? 2000 : 500);
}

function maskEmail(value: string): string {
    const match = /^([^@]+)@(.+)$/u.exec(value);
    if (!match) return value.slice(0, 3) + '***';
    const local = match[1];
    return `${local.slice(0, Math.min(2, local.length))}***@${match[2]}`;
}

function maskIp(value: string): string {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return value.replace(/\.\d{1,3}\.\d{1,3}$/u, '.x.x');
    return value.slice(0, 8) + '…';
}

export function boundedText(value: unknown, length: number): string {
    const scalar =
        value == null
            ? ''
            : typeof value === 'string'
              ? value
              : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
                ? String(value)
                : '';
    return scalar
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .trim()
        .slice(0, length);
}

export function normalizedOptional(value: unknown, length: number): string | null {
    const normalized = boundedText(value, length);
    return normalized || null;
}
