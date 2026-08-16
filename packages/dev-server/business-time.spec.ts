import { describe, expect, it } from 'vitest';

import { BUSINESS_TIME_ZONE, configureBusinessTimeZone } from './business-time';

describe('server business timezone', () => {
    it('uses Beijing time for development when TZ is not configured', () => {
        const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };

        expect(configureBusinessTimeZone(env)).toBe(BUSINESS_TIME_ZONE);
        expect(env.TZ).toBe('Asia/Shanghai');
    });

    it('accepts Beijing time in production', () => {
        const env = { NODE_ENV: 'production', TZ: 'Asia/Shanghai' };

        expect(configureBusinessTimeZone(env)).toBe('Asia/Shanghai');
    });

    it('rejects a non-Beijing production timezone', () => {
        expect(() =>
            configureBusinessTimeZone({ NODE_ENV: 'production', TZ: 'America/Los_Angeles' }),
        ).toThrow('TZ must be Asia/Shanghai in production');
    });
});
