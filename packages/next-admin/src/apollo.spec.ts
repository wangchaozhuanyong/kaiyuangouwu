import { gql } from '@apollo/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelRequestContext, client, uploadAdminFiles } from './apollo';

function storage(values: Record<string, string> = {}) {
    const items = new Map(Object.entries(values));
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        removeItem: (key: string) => items.delete(key),
    };
}

const request = vi.fn<typeof fetch>();
beforeEach(() => {
    vi.stubGlobal('localStorage', storage({ 'vendure-active-channel-token': 'store-a' }));
    vi.stubGlobal('sessionStorage', storage({ 'vendure-auth-token': 'test-session' }));
    vi.stubGlobal('fetch', request);
    request.mockReset();
});
afterEach(async () => {
    await client.clearStore();
    vi.unstubAllGlobals();
});

describe('admin channel request routing', () => {
    it('uploads multipart files into the selected store and retains the session', async () => {
        request.mockResolvedValue(Response.json({ data: { createAssets: [{ id: 'asset' }] } }));
        const file = new File(['image'], 'icon.png', { type: 'image/png' });
        const result = await uploadAdminFiles('mutation Upload { createAssets { id } }', [file], files => ({
            input: files.map(file => ({ file })),
        }));
        expect(result).toEqual({ createAssets: [{ id: 'asset' }] });
        const init = request.mock.calls[0][1]!;
        expect(init.headers).toEqual({ 'vendure-token': 'store-a', authorization: 'Bearer test-session' });
        expect(init.credentials).toBe('include');
        const form = init.body as FormData;
        expect(JSON.parse(String(form.get('map')))).toEqual({ '0': ['variables.input.0.file'] });
        expect((form.get('0') as File).name).toBe('icon.png');
    });

    it('refuses to upload without a selected store instead of falling back to the default', async () => {
        localStorage.removeItem('vendure-active-channel-token');
        await expect(
            uploadAdminFiles('mutation Upload { createAssets { id } }', [], () => ({})),
        ).rejects.toThrow('请先选择店铺');
        expect(request).not.toHaveBeenCalled();
    });

    it('uses explicit store context without changing the globally selected store', async () => {
        request.mockResolvedValue(Response.json({ data: { activeChannel: { id: 'b' } } }));
        await client.query({
            query: gql`
                query BrandChannelProbe {
                    activeChannel {
                        id
                    }
                }
            `,
            fetchPolicy: 'no-cache',
            context: channelRequestContext('store-b'),
        });
        expect(request.mock.calls[0][1]?.headers).toMatchObject({
            'vendure-token': 'store-b',
            authorization: 'Bearer test-session',
        });
        expect(localStorage.getItem('vendure-active-channel-token')).toBe('store-a');
    });

    it('keeps ordinary requests scoped to the current store', async () => {
        request.mockResolvedValue(Response.json({ data: { activeChannel: { id: 'a' } } }));
        await client.query({
            query: gql`
                query CurrentChannelProbe {
                    activeChannel {
                        id
                    }
                }
            `,
            fetchPolicy: 'no-cache',
        });
        expect(request.mock.calls[0][1]?.headers).toMatchObject({ 'vendure-token': 'store-a' });
    });
});
