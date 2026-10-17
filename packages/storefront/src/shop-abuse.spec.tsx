// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { GptRechargeApi } from './api/gpt-recharge';
import { parseShopApiResponse } from './api/helpers';
import { GptRechargePage } from './client-plugins/gpt-recharge/gpt-recharge-page';
import { ShopAbuseChallengeControl, useShopAbuseChallenge } from './components/common/shop-abuse-challenge';
import { type ShopAbuseAction, type ShopAbuseClient, shopAbuseMetadata } from './shop-abuse';
import { shopAbuseErrorMessage } from './shop-abuse-copy';
import { type MarketConfig, type StorefrontLanguage } from './types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const png = 'data:image/png;base64,iVBORw0KGgo=';
const image = () => ({
    id: 'synthetic-challenge',
    imageDataUrl: png,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
});
const denied = (errorCode = 'SHOP_ABUSE_CHALLENGE_REQUIRED', action: ShopAbuseAction = 'LOGIN') =>
    Object.assign(new Error('untrusted provider detail'), { errorCode, action, retryAfterSeconds: 3 });
let host: HTMLDivElement;
let root: Root;
let hook: ReturnType<typeof useShopAbuseChallenge>;
function Harness({
    client,
    language = 'zh',
}: {
    client: Partial<ShopAbuseClient>;
    language?: StorefrontLanguage;
}) {
    hook = useShopAbuseChallenge(client, language);
    return <ShopAbuseChallengeControl challenge={hook} language={language} />;
}
async function settle(work: () => unknown) {
    await act(async () => {
        await work();
    });
}
function setInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype =
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}
beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

describe('per-operation security challenge', () => {
    it('keeps normal requests compatible and only manually submits a normalized proof after a rejection', async () => {
        const client = { createShopAbuseChallenge: vi.fn().mockResolvedValue(image()) };
        const work = vi.fn().mockRejectedValueOnce(denied()).mockResolvedValue('done');
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(work).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(client.createShopAbuseChallenge).toHaveBeenCalledWith(
            'LOGIN',
            'local@example.invalid',
            expect.any(AbortSignal),
        );
        expect(host.querySelector('img')?.width).toBe(232);
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(work).toHaveBeenCalledTimes(1);
        await settle(() => hook.setAnswer('a b c 2 3 4'));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(work).toHaveBeenLastCalledWith({ id: 'synthetic-challenge', answer: 'ABC234' });
        expect(hook.state).toBeNull();
    });
    it('does not reuse proofs across actions or targets', async () => {
        const client = { createShopAbuseChallenge: vi.fn().mockResolvedValue(image()) };
        const rejected = vi.fn().mockRejectedValue(denied());
        const other = vi.fn().mockResolvedValue('ok');
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => hook.execute('LOGIN', 'one@example.invalid', rejected));
        await settle(() => hook.setAnswer('ABC234'));
        await settle(() => hook.execute('REGISTER', 'one@example.invalid', other));
        expect(other).toHaveBeenLastCalledWith(undefined);
        await settle(() => hook.execute('LOGIN', 'one@example.invalid', rejected));
        await settle(() => hook.setAnswer('ABC234'));
        await settle(() => hook.execute('LOGIN', 'two@example.invalid', other));
        expect(other).toHaveBeenLastCalledWith(undefined);
    });
    it('refreshes rejected or expired proofs without replaying the business request', async () => {
        const client = { createShopAbuseChallenge: vi.fn().mockResolvedValue(image()) };
        const work = vi
            .fn()
            .mockRejectedValueOnce(denied())
            .mockRejectedValueOnce(denied('SHOP_ABUSE_CHALLENGE_INVALID'));
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        await settle(() => hook.setAnswer('ABC234'));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(work).toHaveBeenCalledTimes(2);
        expect(client.createShopAbuseChallenge).toHaveBeenCalledTimes(2);
        expect(hook.state?.answer).toBe('');
        const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        now.mockRestore();
        expect(work).toHaveBeenCalledTimes(2);
        expect(client.createShopAbuseChallenge).toHaveBeenCalledTimes(3);
    });
    it.each(['SHOP_ABUSE_RATE_LIMITED', 'SHOP_ABUSE_UNAVAILABLE'])(
        'allows an explicit retry after %s without requiring an image',
        async code => {
            const client = { createShopAbuseChallenge: vi.fn() };
            const work = vi.fn().mockRejectedValueOnce(denied(code)).mockResolvedValue('done');
            await settle(() => root.render(<Harness client={client} />));
            await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
            expect(host.querySelector('input')).toBeNull();
            expect(host.querySelector('button')).toBeNull();
            expect(host.textContent).not.toContain('请输入图片验证码');
            expect(work).toHaveBeenCalledTimes(1);
            await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
            expect(work).toHaveBeenCalledTimes(2);
            expect(client.createShopAbuseChallenge).not.toHaveBeenCalled();
        },
    );
    it('allows a manual business retry when the image service itself is rate limited', async () => {
        const client = {
            createShopAbuseChallenge: vi.fn().mockRejectedValue(denied('SHOP_ABUSE_RATE_LIMITED')),
        };
        const work = vi.fn().mockRejectedValueOnce(denied()).mockResolvedValue('done');
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(host.querySelector('input')).toBeNull();
        expect(host.querySelector('button')).toBeNull();
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', work));
        expect(work).toHaveBeenCalledTimes(2);
        expect(hook.state).toBeNull();
    });
    it('resets challenge feedback when language changes and rejects non-PNG challenges', async () => {
        const client = {
            createShopAbuseChallenge: vi
                .fn()
                .mockResolvedValue({ ...image(), imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }),
        };
        await settle(() => root.render(<Harness client={client} />));
        await settle(() => hook.execute('LOGIN', 'local@example.invalid', () => Promise.reject(denied())));
        expect(host.querySelector('img')).toBeNull();
        expect(host.textContent).toContain('验证图片暂时无法加载');
        await settle(() => root.render(<Harness client={client} language="en" />));
        expect(hook.state).toBeNull();
        expect(host.textContent).toBe('');
    });
});

describe('safe challenge transport', () => {
    it('keeps only typed action and bounded retry metadata and uses localized safe copy', () => {
        expect(shopAbuseMetadata({ action: 'LOGIN', retryAfterSeconds: 3, token: 'synthetic' })).toEqual({
            action: 'LOGIN',
            retryAfterSeconds: 3,
        });
        expect(shopAbuseMetadata({ action: 'private', retryAfterSeconds: -1 })).toEqual({});
        let error: unknown;
        try {
            parseShopApiResponse(
                JSON.stringify({
                    errors: [
                        {
                            message: 'private upstream detail',
                            extensions: {
                                code: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
                                action: 'RECHARGE_SUBMIT',
                                retryAfterSeconds: 4,
                                token: 'synthetic',
                            },
                        },
                    ],
                }),
                401,
                false,
            );
        } catch (cause) {
            error = cause;
        }
        expect(error).toMatchObject({
            errorCode: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
            action: 'RECHARGE_SUBMIT',
            retryAfterSeconds: 4,
        });
        expect(error).not.toHaveProperty('token');
        expect(shopAbuseErrorMessage(error, 'zh')).not.toMatch(/private|登录/);
        expect(shopAbuseErrorMessage(error, 'en')).not.toContain('private');
        expect(shopAbuseErrorMessage(error, 'en')).not.toBe(shopAbuseErrorMessage(error, 'zh'));
    });
    it('isolates concurrent proofs to the one request and leaves legacy requests without proof headers', async () => {
        const calls: RequestInit[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: unknown, init: RequestInit) => {
                calls.push(init);
                return Promise.resolve(
                    new Response(JSON.stringify({ data: { value: true } }), { status: 200 }),
                );
            }),
        );
        const market = {
            code: 'synthetic',
            defaultLanguageCode: 'zh_Hans',
            currencyCode: 'CNY',
            countryCode: 'CN',
            locale: 'zh-CN',
            label: 'Test',
        } as MarketConfig;
        const api = new ShopApi(market);
        await Promise.all([
            api.request('mutation One { value }', {}, undefined, undefined, false, false, undefined, {
                id: 'proof-one',
                answer: 'ABC234',
            }),
            api.request('mutation Two { value }'),
            api.request('mutation Three { value }', {}, undefined, undefined, false, false, undefined, {
                id: 'proof-three',
                answer: 'DEF567',
            }),
        ]);
        expect(new Headers(calls[0].headers).get('x-shop-abuse-id')).toBe('proof-one');
        expect(new Headers(calls[1].headers).has('x-shop-abuse-answer')).toBe(false);
        expect(new Headers(calls[2].headers).get('x-shop-abuse-id')).toBe('proof-three');
        expect(calls.every(call => typeof call.body === 'string' && !call.body.includes('ABC234'))).toBe(
            true,
        );
    });
    it('preserves the existing authentication token when a security check returns HTTP 401', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ data: { login: { __typename: 'CurrentUser', id: 'synthetic-user' } } }),
                    { status: 200, headers: { 'vendure-auth-token': 'synthetic-test-auth' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        errors: [
                            {
                                message: 'synthetic rejection',
                                extensions: { code: 'SHOP_ABUSE_CHALLENGE_REQUIRED', action: 'LOGIN' },
                            },
                        ],
                    }),
                    { status: 401 },
                ),
            )
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { value: true } }), { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        const api = new ShopApi({
            code: 'synthetic',
            defaultLanguageCode: 'zh_Hans',
            currencyCode: 'CNY',
        } as MarketConfig);
        await api.login('local@example.invalid', 'synthetic-password');
        await expect(api.login('local@example.invalid', 'synthetic-password')).rejects.toMatchObject({
            errorCode: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
        });
        await api.request('query ExistingSession { value }');
        const init = fetch.mock.calls[2][1] as RequestInit;
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-test-auth');
    });
    it('forwards recharge proof in the correct context slot, keeping it out of variables', async () => {
        const request = vi.fn().mockResolvedValue({
            verifyGptRechargeCode: { plan: 'plus', status: 'available' },
            submitGptRecharge: { id: 'synthetic-task' },
            queryGptRechargeCode: { plan: 'plus', status: 'available' },
        });
        const api = new GptRechargeApi({ request });
        const proof = { id: 'synthetic-proof', answer: 'ABC234' };
        await api.verify('synthetic-code', proof);
        await api.query('synthetic-code', proof);
        await api.submit('synthetic-code', '{}', proof);
        for (const args of request.mock.calls) {
            expect(args[6]).toEqual(proof);
            expect(args[1]).not.toHaveProperty('proof');
        }
    });
});

it('keeps recharge session and confirmation after a challenge rejection and never presents an uncertain result', async () => {
    const client = {
        config: vi.fn().mockResolvedValue({ enabled: true, maintenance: false }),
        verify: vi.fn().mockResolvedValue({ plan: 'plus', status: 'available' }),
        query: vi.fn(),
        task: vi.fn(),
        submit: vi.fn().mockRejectedValueOnce(denied('SHOP_ABUSE_CHALLENGE_REQUIRED', 'RECHARGE_SUBMIT')),
        createShopAbuseChallenge: vi.fn().mockResolvedValue(image()),
    };
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await settle(() =>
        root.render(
            <QueryClientProvider client={cache}>
                <GptRechargePage client={client} marketKey="synthetic" onBack={vi.fn()} />
            </QueryClientProvider>,
        ),
    );
    await settle(() => setInput(host.querySelector('#gpt-code') as HTMLInputElement, 'synthetic-code'));
    await settle(() =>
        host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    const session = JSON.stringify({
        user: { id: 'synthetic-user', email: 'local@example.invalid' },
        accessToken: 'demonstration-invalid-credential',
    });
    await settle(() => setInput(host.querySelector('#gpt-session') as HTMLTextAreaElement, session));
    await settle(() => (host.querySelector('.gpt-recharge-confirm input') as HTMLInputElement).click());
    await settle(() => (host.querySelector('.gpt-recharge-submit') as HTMLButtonElement).click());
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect((host.querySelector('#gpt-session') as HTMLTextAreaElement).value).toBe(session);
    expect((host.querySelector('.gpt-recharge-confirm input') as HTMLInputElement).checked).toBe(true);
    expect(host.textContent).not.toContain('正在确认提交结果');
    expect(host.textContent).toContain('请输入图片验证码');
    cache.clear();
});
