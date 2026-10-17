// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ShopAbuseClient } from '../../shop-abuse';
import { type StorefrontLanguage } from '../../types';

import { ShopAbuseChallengeControl, useShopAbuseChallenge } from './shop-abuse-challenge';

const loader = vi.hoisted(() => ({ entered: vi.fn(), gate: Promise.resolve() }));
vi.mock('./shop-abuse-challenge-implementation', async importOriginal => {
    loader.entered();
    await loader.gate;
    return importOriginal();
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const rejection = () =>
    Object.assign(new Error('synthetic'), { errorCode: 'SHOP_ABUSE_CHALLENGE_REQUIRED', action: 'LOGIN' });
const image = () => ({
    id: 'synthetic-challenge',
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
});
let host: HTMLDivElement;
let root: Root;
let hook: ReturnType<typeof useShopAbuseChallenge>;
function Harness({
    client,
    language = 'zh',
    submit,
}: {
    client: Partial<ShopAbuseClient>;
    language?: StorefrontLanguage;
    submit?: () => void;
}) {
    hook = useShopAbuseChallenge(client, language);
    return <ShopAbuseChallengeControl challenge={hook} language={language} onSubmit={submit} />;
}
async function settle(work: () => unknown) {
    await act(async () => {
        await work();
    });
}
beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('security verification loaded after a rejection', () => {
    it('does not import the engine, UI or its CSS for a normal request or normal business rejection', async () => {
        const client = { createShopAbuseChallenge: vi.fn() };
        const success = vi.fn().mockResolvedValue('done');
        const failure = vi.fn().mockRejectedValue(new Error('synthetic business failure'));
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', success));
        await settle(() =>
            expect(hook.execute('LOGIN', 'local@example.invalid', failure)).rejects.toThrow(
                'synthetic business failure',
            ),
        );
        expect(loader.entered).not.toHaveBeenCalled();
        expect(client.createShopAbuseChallenge).not.toHaveBeenCalled();
        expect(host.childElementCount).toBe(0);
    });
    it('drops a late dynamic import after reset without replaying the rejected operation', async () => {
        let release!: () => void;
        loader.gate = new Promise(resolve => {
            release = resolve;
        });
        const client = { createShopAbuseChallenge: vi.fn().mockResolvedValue(image()) };
        const work = vi.fn().mockRejectedValue(rejection());
        await settle(() => root.render(<Harness client={client} />));
        const pending = hook.execute('LOGIN', 'local@example.invalid', work);
        await vi.waitFor(() => expect(loader.entered).toHaveBeenCalledOnce());
        await settle(() => hook.reset());
        await settle(async () => {
            release();
            await pending;
        });
        expect(work).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(client.createShopAbuseChallenge).not.toHaveBeenCalled();
        expect(hook.state).toBeNull();
    });
    it('ignores late images after language reset and supports explicit Enter submission', async () => {
        let resolveImage!: (value: ReturnType<typeof image>) => void;
        const client = {
            createShopAbuseChallenge: vi
                .fn()
                .mockImplementationOnce(
                    () =>
                        new Promise(resolve => {
                            resolveImage = resolve;
                        }),
                )
                .mockResolvedValue(image()),
        };
        const work = vi.fn().mockRejectedValue(rejection());
        const submit = vi.fn();
        await settle(() => root.render(<Harness client={client} submit={submit} />));
        let pending!: Promise<unknown>;
        await settle(() => {
            pending = hook.execute('LOGIN', 'local@example.invalid', work);
        });
        await vi.waitFor(() => expect(client.createShopAbuseChallenge).toHaveBeenCalledOnce());
        await settle(() => root.render(<Harness client={client} language="en" submit={submit} />));
        await settle(async () => {
            resolveImage(image());
            await pending;
        });
        expect(hook.state).toBeNull();
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(host.textContent).toContain('Enter the image verification code');
        await settle(() =>
            host
                .querySelector('input')
                ?.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
                ),
        );
        expect(submit).toHaveBeenCalledOnce();
        expect(work).toHaveBeenCalledTimes(2);
    });
    it('keeps the new challenge when an older unguarded business request finishes late', async () => {
        const client = { createShopAbuseChallenge: vi.fn().mockResolvedValue(image()) };
        let resolveOld!: (value: string) => void;
        let oldRequest!: Promise<unknown>;
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => {
            oldRequest = hook.execute(
                'LOGIN',
                'old@example.invalid',
                () =>
                    new Promise<string>(resolve => {
                        resolveOld = resolve;
                    }),
            );
        });
        await settle(() => hook.execute('LOGIN', 'new@example.invalid', () => Promise.reject(rejection())));
        expect(hook.state?.target).toBe('new@example.invalid');
        await settle(async () => {
            resolveOld('done');
            await oldRequest;
        });
        expect(hook.state?.target).toBe('new@example.invalid');
        expect(hook.state?.challenge?.id).toBe('synthetic-challenge');
    });
    it('aborts and ignores an image request when its owner unmounts', async () => {
        let resolveImage!: (value: ReturnType<typeof image>) => void;
        let signal: AbortSignal | undefined;
        const client = {
            createShopAbuseChallenge: vi.fn(
                (_action: unknown, _target: unknown, requestSignal?: AbortSignal) => {
                    signal = requestSignal;
                    return new Promise<ReturnType<typeof image>>(resolve => {
                        resolveImage = resolve;
                    });
                },
            ),
        };
        await settle(() => root.render(<Harness client={client} />));
        let pending!: Promise<unknown>;
        await settle(() => {
            pending = hook.execute('LOGIN', 'local@example.invalid', () => Promise.reject(rejection()));
        });
        await vi.waitFor(() => expect(client.createShopAbuseChallenge).toHaveBeenCalledOnce());
        await settle(() => root.render(null));
        expect(signal?.aborted).toBe(true);
        await settle(async () => {
            resolveImage(image());
            await pending;
        });
        expect(host.childElementCount).toBe(0);
    });
});
