import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/vdb/constants.js', () => ({
    LS_KEY_SELECTED_CHANNEL_TOKEN: 'vendure-selected-channel-token',
    LS_KEY_SESSION_TOKEN: 'vendure-session-token',
    LS_KEY_USER_SETTINGS: 'vendure-user-settings',
}));

vi.mock('virtual:vendure-ui-config', () => ({
    uiConfig: {
        api: {
            host: 'https://dashboard.invalid',
            port: '443',
            adminApiPath: 'admin-api',
            channelTokenKey: 'vendure-token',
            authTokenHeaderKey: 'vendure-auth-token',
        },
    },
}));

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'dashboard.invalid', port: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('sends the CSRF preflight header with a real GraphQL multipart upload', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ data: { createAssets: [{ id: 'fixture' }] } }));
    vi.stubGlobal('fetch', request);
    const { api } = await import('./api.js');
    const file = new File(['synthetic'], 'fixture.png', { type: 'image/png' });
    await expect(
        api.mutate('mutation($input:[CreateAssetInput!]!){createAssets(input:$input){...on Asset{id}}}', {
            input: [{ file }],
        }),
    ).resolves.toEqual({ createAssets: [{ id: 'fixture' }] });
    const init = request.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Apollo-Require-Preflight')).toBe('true');
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.credentials).toBe('include');
    expect((init.body as FormData).has('operations')).toBe(true);
});
