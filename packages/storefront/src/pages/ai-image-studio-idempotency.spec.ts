import { describe, expect, it, vi } from 'vitest';

import { stableImageStudioRequest } from './ai-image-studio-idempotency';

describe('stableImageStudioRequest', () => {
    it('reuses the idempotency key after an unknown network result with unchanged settings', () => {
        const createId = vi.fn().mockReturnValueOnce('request-1').mockReturnValueOnce('request-2');
        const first = stableImageStudioRequest(null, 'same-form', createId);
        const retry = stableImageStudioRequest(first, 'same-form', createId);
        const changed = stableImageStudioRequest(retry, 'changed-form', createId);

        expect(retry.idempotencyKey).toBe('request-1');
        expect(changed.idempotencyKey).toBe('request-2');
        expect(createId).toHaveBeenCalledTimes(2);
    });
});
