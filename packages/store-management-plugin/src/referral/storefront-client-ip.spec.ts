import { describe, expect, it } from 'vitest';

import { storefrontClientIp } from './storefront-client-ip';

describe('storefront client IP', () => {
    it('normalizes IPv4-mapped addresses reported by Express', () => {
        expect(storefrontClientIp({ ip: '::ffff:203.0.113.10' })).toBe('203.0.113.10');
    });

    it('keeps valid IPv6 addresses', () => {
        expect(storefrontClientIp({ ip: '2001:db8::1' })).toBe('2001:db8::1');
    });

    it('falls back to the socket address', () => {
        expect(storefrontClientIp({ socket: { remoteAddress: '198.51.100.8' } })).toBe('198.51.100.8');
    });

    it('rejects missing or invalid addresses', () => {
        expect(storefrontClientIp({ ip: 'not-an-ip' })).toBeNull();
        expect(storefrontClientIp(undefined)).toBeNull();
    });
});
