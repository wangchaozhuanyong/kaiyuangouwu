import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPrivateAddress, SafeProviderUrlService } from './safe-provider-url.service';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

describe('SafeProviderUrlService', () => {
    const originalRemoteHosts = process.env.IMAGE_GENERATION_REMOTE_IMAGE_HOSTS;
    afterEach(() => {
        lookup.mockReset();
        if (originalRemoteHosts == null) delete process.env.IMAGE_GENERATION_REMOTE_IMAGE_HOSTS;
        else process.env.IMAGE_GENERATION_REMOTE_IMAGE_HOSTS = originalRemoteHosts;
    });
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
        '::ffff:7f00:1',
        '0:0:0:0:0:ffff:a00:1',
        'febf::1',
        'ff02::1',
        'invalid-address',
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

    it('resolves once and returns the checked address for the actual connection', async () => {
        lookup
            .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
            .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
        const service = new SafeProviderUrlService();
        expect(await service.resolveForRequest('https://provider.invalid/v1')).toEqual({
            url: new URL('https://provider.invalid/v1'),
            address: '8.8.8.8',
            family: 4,
        });
        expect(lookup).toHaveBeenCalledTimes(1);
        await expect(service.resolveForRequest('https://provider.invalid/v1')).rejects.toThrow('内网');
    });

    it('rejects mixed public/private DNS and empty results', async () => {
        const service = new SafeProviderUrlService();
        lookup.mockResolvedValueOnce([
            { address: '8.8.8.8', family: 4 },
            { address: '::ffff:7f00:1', family: 6 },
        ]);
        await expect(service.resolveForRequest('https://provider.invalid')).rejects.toThrow('内网');
        lookup.mockResolvedValueOnce([]);
        await expect(service.resolveForRequest('https://provider.invalid')).rejects.toThrow();
    });

    it('handles bracketed IPv6 URLs without bypassing private address checks', async () => {
        const service = new SafeProviderUrlService();
        await expect(service.validate('https://[::ffff:7f00:1]/')).rejects.toThrow('内网');
        await expect(service.resolveForRequest('https://[2001:4860:4860::8888]/')).resolves.toMatchObject({
            address: '2001:4860:4860::8888',
            family: 6,
        });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('does not re-resolve an allowlisted image after validating it', async () => {
        process.env.IMAGE_GENERATION_REMOTE_IMAGE_HOSTS = 'images.invalid';
        lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
        expect(
            await new SafeProviderUrlService().resolveRemoteImage('https://images.invalid/a.png'),
        ).toMatchObject({ address: '8.8.8.8' });
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('requires an exact remote-image hostname allowlist and returns a pinned public address', async () => {
        const service = new SafeProviderUrlService();
        process.env.IMAGE_GENERATION_REMOTE_IMAGE_HOSTS = '8.8.8.8';

        await expect(service.resolveRemoteImage('https://1.1.1.1/image.png')).rejects.toThrow('白名单');
        await expect(service.resolveRemoteImage('https://8.8.8.8/image.png')).resolves.toEqual({
            url: new URL('https://8.8.8.8/image.png'),
            address: '8.8.8.8',
            family: 4,
        });
    });
});
