import { describe, expect, it } from 'vitest';

import { aiAccessReason, classifyAiAccessFailure } from './ai-access-failure';
import { responseTelemetry } from './image-provider-telemetry';
describe('confirmed AI credential failures', () => {
    it.each([
        ['invalid_api_key', 401, 'INVALID'],
        ['API_KEY_EXPIRED', 403, 'EXPIRED'],
        ['account_deactivated', 403, 'DISABLED'],
        ['insufficient_balance', 402, 'BALANCE'],
        ['insufficient_quota', 429, 'QUOTA'],
        ['token_quota_exhausted', 429, 'QUOTA'],
    ])('classifies %s with safe Chinese reasons', (code, status, expected) => {
        const raw = { error: { code, message: 'private prompt and secret-value' } };
        const result = classifyAiAccessFailure(raw, Number(status));
        expect(result).toBe(expected);
        const telemetry = responseTelemetry(new Response('', { status: Number(status) }), raw);
        expect(telemetry.accessFailure).toBe(expected);
        expect(JSON.stringify(telemetry)).not.toMatch(/private prompt|secret-value/);
        if (!result) throw new Error('Expected a confirmed reason');
        expect(aiAccessReason[result]).toMatch(/上游明确/);
    });
    it.each([
        [429, { code: 'rate_limit_exceeded', message: 'tokens per minute' }],
        [403, { code: 'model_not_found', message: 'model access permission denied' }],
        [400, { code: 'content_policy_violation' }],
        [400, { code: 'invalid_image_size' }],
        [408, { message: 'timeout' }],
        [429, { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' }],
        [401, { message: 'unknown' }],
    ])('does not infer depleted credentials from HTTP %s', (status, error) => {
        expect(classifyAiAccessFailure({ error }, status)).toBeUndefined();
    });
    it('reads explicit Gemini error details without equating resource exhaustion with account quota', () => {
        expect(
            classifyAiAccessFailure(
                { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_INVALID' }] } },
                403,
            ),
        ).toBe('INVALID');
    });
});
