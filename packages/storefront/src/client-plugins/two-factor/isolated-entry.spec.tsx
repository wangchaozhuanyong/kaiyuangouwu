// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- React act uses asynchronous callbacks. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActiveCustomer } from '../../types';

import { CustomerTwoFactorEntry } from './isolated-entry';

vi.mock('./browser-storage', () => ({ browserVaultStorage: () => ({ inspect: () => null }) }));
vi.mock('./anonymous-owner', () => ({ getAnonymousTwoFactorOwnerId: () => 'anonymous-fixture' }));
vi.mock('./two-factor-page', () => ({ TwoFactorPage: () => <p>Local vault</p> }));

const origin = 'https://vault.example.test';
const cleanups: Array<() => void> = [];
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_TWO_FACTOR_ORIGIN', origin);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Required fixture element is missing');
    return value;
}
async function setup() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onBack = vi.fn();
    const render = async (ownerId = 'customer-1') => {
        await act(async () =>
            root.render(
                <CustomerTwoFactorEntry
                    customer={{ id: ownerId } as ActiveCustomer}
                    language="zh"
                    onBack={onBack}
                    onSignIn={() => undefined}
                    onNotify={() => undefined}
                />,
            ),
        );
    };
    await render();
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    return { container, onBack, render };
}
async function send(source: Window | null, type: string, messageOrigin = origin) {
    await act(async () =>
        window.dispatchEvent(
            new MessageEvent('message', {
                source,
                origin: messageOrigin,
                data: { type },
            }),
        ),
    );
}
async function advance(ms: number) {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
}

describe('isolated 2FA handshake recovery', () => {
    it('times out locally at 10 seconds and accepts a late trusted initialization', async () => {
        const { container } = await setup();
        const frame = required(container.querySelector('iframe'));
        await advance(9999);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        await advance(1);
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('重试');
        expect(container.querySelector('iframe')).toBe(frame);
        await send(frame.contentWindow, 'vendure-vault-initialized');
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.querySelector('[role="status"]')).toBeNull();
        await advance(10000);
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('retries only the iframe and rejects stale, wrong-origin and wrong-source messages', async () => {
        const { container, onBack } = await setup();
        const oldFrame = required(container.querySelector('iframe'));
        const oldSource = oldFrame.contentWindow;
        await advance(10000);
        const retry = container.querySelector('button');
        expect(retry?.textContent).toContain('重试');
        await act(async () => required(retry).click());
        const frame = required(container.querySelector('iframe'));
        expect(frame).not.toBe(oldFrame);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        await send(oldSource, 'vendure-vault-initialized');
        await send(frame.contentWindow, 'vendure-vault-initialized', 'https://attacker.example');
        await send(window, 'vendure-vault-back');
        expect(container.querySelector('[role="status"]')).not.toBeNull();
        expect(onBack).not.toHaveBeenCalled();
        await advance(9999);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        await advance(1);
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        await send(frame.contentWindow, 'vendure-vault-initialized');
        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('does not restart the timeout when parent callbacks rerender', async () => {
        const { container, render } = await setup();
        await advance(9000);
        await render();
        await advance(1000);
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('starts a new isolated handshake after an owner change without leaking the prior owner', async () => {
        const { container, render } = await setup();
        const oldSource = required(container.querySelector('iframe')).contentWindow;
        await send(oldSource, 'vendure-vault-initialized');
        await render('customer-2');
        const frame = required(container.querySelector('iframe'));
        const post = vi.spyOn(required(frame.contentWindow), 'postMessage');
        await send(oldSource, 'vendure-vault-initialized');
        expect(container.querySelector('[role="status"]')).not.toBeNull();
        await send(frame.contentWindow, 'vendure-vault-ready');
        expect(post).toHaveBeenCalledWith(
            { type: 'vendure-vault-init', ownerId: 'customer-2', language: 'zh' },
            origin,
        );
        await advance(10000);
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
});
