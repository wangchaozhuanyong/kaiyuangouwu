// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { GptRechargeApi } from './api/gpt-recharge';
import { parseShopApiResponse } from './api/helpers';
import { type GptRechargeClient } from './client-plugins/gpt-recharge/contracts';
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
const rechargeCaches = new Set<QueryClient>();
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
    for (const cache of rechargeCaches) cache.clear();
    rechargeCaches.clear();
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

function rechargeClient() {
    return {
        config: vi.fn().mockResolvedValue({ enabled: true, maintenance: false }),
        verify: vi.fn().mockResolvedValue({ plan: 'plus', status: 'available' }),
        query: vi.fn().mockResolvedValue({ plan: 'plus', status: 'available' }),
        submit: vi.fn().mockResolvedValue({
            id: 'synthetic-task',
            credential: 'synthetic-task-credential',
            plan: 'plus',
            status: 'queued',
            updatedAt: '2026-10-17T00:00:00Z',
        }),
        task: vi.fn(),
        createShopAbuseChallenge: vi.fn().mockResolvedValue(image()),
    };
}

async function renderRecharge(client: GptRechargeClient, language: StorefrontLanguage = 'zh') {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    rechargeCaches.add(cache);
    await settle(() =>
        root.render(
            <QueryClientProvider client={cache}>
                <GptRechargePage client={client} language={language} marketKey="synthetic" onBack={vi.fn()} />
            </QueryClientProvider>,
        ),
    );
}

async function verifyRecharge() {
    await settle(() => setInput(host.querySelector('#gpt-code') as HTMLInputElement, 'synthetic-code'));
    await settle(() =>
        host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
}

async function prepareRechargeSubmission() {
    await verifyRecharge();
    await settle(() =>
        setInput(
            host.querySelector('#gpt-session') as HTMLTextAreaElement,
            JSON.stringify({
                user: { id: 'synthetic-user', email: 'local@example.invalid' },
                accessToken: 'synthetic-not-a-real-credential',
            }),
        ),
    );
    await settle(() => (host.querySelector('.gpt-recharge-confirm input') as HTMLInputElement).click());
}

describe('recharge feedback follows the action that failed', () => {
    it.each(['zh', 'en'] as const)(
        'validates an empty code locally and explains the next step in %s',
        async language => {
            const client = rechargeClient();
            await renderRecharge(client, language);
            const button = host.querySelector(
                '.gpt-recharge-code-section button[type="submit"]',
            ) as HTMLButtonElement;
            expect(button.textContent).toBe(language === 'zh' ? '验证兑换码' : 'Verify code');
            expect(button.disabled).toBe(false);
            await vi.waitFor(async () => {
                await settle(() => Promise.resolve());
                expect(host.querySelector('#gpt-submit-help')?.textContent).toMatch(
                    language === 'zh' ? /验证兑换码/ : /verify.*code/i,
                );
            });
            await settle(() => button.click());
            const input = host.querySelector('#gpt-code');
            expect(client.verify).not.toHaveBeenCalled();
            expect(client.createShopAbuseChallenge).not.toHaveBeenCalled();
            expect(input?.getAttribute('aria-invalid')).toBe('true');
            expect(input?.getAttribute('aria-describedby')).toContain('gpt-code-error');
            expect(host.querySelector('#gpt-code-error')?.textContent).toBeTruthy();
            expect(document.activeElement).toBe(input);
        },
    );

    it.each([
        new Error('Synthetic private provider detail'),
        Object.assign(new Error('Synthetic private provider detail'), { errorCode: 'USER_INPUT_ERROR' }),
    ])(
        'keeps an ambiguous verification failure by its button without blaming the code field (%#)',
        async reason => {
            const client = rechargeClient();
            client.verify.mockRejectedValue(reason);
            await renderRecharge(client);
            await verifyRecharge();
            const feedback = host.querySelector('#gpt-verify-error');
            expect(feedback?.closest('.gpt-recharge-code-section')).not.toBeNull();
            expect(feedback?.getAttribute('role')).toBe('alert');
            expect(document.activeElement).toBe(feedback);
            expect(host.querySelector('#gpt-code')?.getAttribute('aria-invalid')).not.toBe('true');
            expect(host.querySelector('.gpt-recharge-notices')?.textContent ?? '').not.toContain(
                feedback?.textContent,
            );
            expect(host.textContent).not.toContain('Synthetic private');
            expect(feedback?.textContent).not.toContain('提交的信息有误');
        },
    );

    it('uses the same explicit button below an on-demand challenge and never replays verification', async () => {
        const client = rechargeClient();
        client.verify.mockRejectedValueOnce(denied('SHOP_ABUSE_CHALLENGE_REQUIRED', 'RECHARGE_CODE'));
        await renderRecharge(client);
        expect(client.createShopAbuseChallenge).not.toHaveBeenCalled();
        await verifyRecharge();
        await vi.waitFor(async () => {
            await settle(() => Promise.resolve());
            expect(host.querySelector('.shop-abuse-challenge input')).not.toBeNull();
        });
        const control = host.querySelector('.shop-abuse-challenge') as HTMLElement;
        expect(control.querySelector('input')?.closest('.auth-input-shell')).not.toBeNull();
        const button = host.querySelector(
            '.gpt-recharge-code-section button[type="submit"]',
        ) as HTMLButtonElement;
        expect(control.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(control.textContent).toContain('验证兑换码');
        expect(client.verify).toHaveBeenCalledTimes(1);
        await settle(() => button.click());
        expect(client.verify).toHaveBeenCalledTimes(1);
        const feedback = control.querySelector('.shop-abuse-challenge-error');
        expect(feedback?.getAttribute('role')).toBe('alert');
        await settle(() => setInput(control.querySelector('input') as HTMLInputElement, 'ABC'));
        await settle(() => button.click());
        expect(client.verify).toHaveBeenCalledTimes(1);
        expect(control.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(control.querySelector('input'));
        await settle(() => setInput(control.querySelector('input') as HTMLInputElement, 'ABC234'));
        await settle(() => button.click());
        expect(client.verify).toHaveBeenCalledTimes(2);
        expect(client.verify).toHaveBeenLastCalledWith('synthetic-code', {
            id: 'synthetic-challenge',
            answer: 'ABC234',
        });
        expect(host.querySelector('.shop-abuse-challenge')).toBeNull();
    });

    it('places lookup errors inside the lookup action instead of the recharge form', async () => {
        const client = rechargeClient();
        client.query.mockRejectedValue(new Error('Synthetic private lookup detail'));
        await renderRecharge(client);
        await settle(() =>
            [...host.querySelectorAll<HTMLButtonElement>('nav button')]
                .find(button => button.textContent === '兑换码查询')
                ?.click(),
        );
        await settle(() => setInput(host.querySelector('#gpt-query') as HTMLInputElement, 'synthetic-code'));
        await settle(() =>
            host
                .querySelector('.gpt-recharge-query form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        const feedback = host.querySelector('#gpt-query-error');
        expect(client.query).toHaveBeenCalledTimes(1);
        expect(feedback?.closest('.gpt-recharge-query')).not.toBeNull();
        expect(document.activeElement).toBe(feedback);
        expect(host.querySelector('#gpt-verify-error')).toBeNull();
        expect(host.textContent).not.toContain('Synthetic private');
    });

    it('shows proven non-acceptance at the submit action and requires fresh account confirmation', async () => {
        const client = rechargeClient();
        client.submit.mockRejectedValue(
            Object.assign(new Error('Synthetic rejection'), {
                errorCode: 'GPT_RECHARGE_NOT_ACCEPTED',
            }),
        );
        await renderRecharge(client);
        await prepareRechargeSubmission();
        await settle(() => (host.querySelector('.gpt-recharge-submit') as HTMLButtonElement).click());
        const feedback = host.querySelector('#gpt-submit-error');
        expect(feedback?.closest('.gpt-recharge-account-section')).not.toBeNull();
        expect(feedback?.textContent).toContain('未受理');
        expect(document.activeElement).toBe(feedback);
        expect((host.querySelector('#gpt-session') as HTMLTextAreaElement).value).toBe('');
        expect((host.querySelector('.gpt-recharge-confirm input') as HTMLInputElement).checked).toBe(false);
        expect((host.querySelector('.gpt-recharge-submit') as HTMLButtonElement).disabled).toBe(true);
        expect(host.textContent).not.toContain('正在确认提交结果');
        expect(client.submit).toHaveBeenCalledTimes(1);
    });

    it('locks an unknown submission and routes recovery to the original code without another write', async () => {
        const client = rechargeClient();
        client.submit.mockRejectedValue(new Error('Synthetic lost response'));
        await renderRecharge(client);
        await prepareRechargeSubmission();
        await settle(() => (host.querySelector('.gpt-recharge-submit') as HTMLButtonElement).click());
        expect(host.textContent).toContain('正在确认提交结果');
        expect(host.querySelector('.gpt-recharge-submit')).toBeNull();
        expect(host.querySelector('#gpt-session')).toBeNull();
        expect(client.submit).toHaveBeenCalledTimes(1);
        await settle(() =>
            [...host.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent === '查询原任务')
                ?.click(),
        );
        expect((host.querySelector('#gpt-query') as HTMLInputElement).value).toBe('synthetic-code');
        expect(client.submit).toHaveBeenCalledTimes(1);
        await settle(() =>
            [...host.querySelectorAll<HTMLButtonElement>('nav button')]
                .find(button => button.textContent === '自助充值')
                ?.click(),
        );
        expect(host.querySelector('.gpt-recharge-submit')).toBeNull();
        expect(client.submit).toHaveBeenCalledTimes(1);
    });
});
