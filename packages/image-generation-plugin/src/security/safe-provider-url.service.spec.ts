import { describe, expect, it } from 'vitest';

import { isPrivateAddress, SafeProviderUrlService } from './safe-provider-url.service';

describe('SafeProviderUrlService', () => {
    it.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.16.0.1',
        '192.168.1.2',
        '169.254.169.254',
        '100.64.0.1',
        '::1',
        'fe80::1',
        'fd00::1',
        '::ffff:127.0.0.1',
    ])('blocks private or metadata address %s', address => {
        expect(isPrivateAddress(address)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('allows public address %s', address => {
        expect(isPrivateAddress(address)).toBe(false);
    });

    it('rejects credentials, fragments, localhost and production HTTP', async () => {
        const service = new SafeProviderUrlService();

        await expect(service.validate('https://user:pass@example.com/v1', false)).rejects.toThrow();
        await expect(service.validate('https://example.com/v1#secret', false)).rejects.toThrow();
        await expect(service.validate('https://localhost/v1', false)).rejects.toThrow('内网');
        await expect(service.validate('http://8.8.8.8/v1', false)).rejects.toThrow('HTTPS');
    });

    it('appends protocol paths without discarding a relay base path', () => {
        const service = new SafeProviderUrlService();
        expect(
            service.endpoint(new URL('https://relay.example.com/openai/v1'), 'images/generations').toString(),
        ).toBe('https://relay.example.com/openai/v1/images/generations');
    });
});
