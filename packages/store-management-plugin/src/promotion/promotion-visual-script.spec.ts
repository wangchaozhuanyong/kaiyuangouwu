import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { PROMOTION_VISUAL_SCRIPT } from './promotion-visual-script';

function entryTicket(expiresAt: number): string {
    const payload = Buffer.from(
        JSON.stringify({ kind: 'entry-ticket', channelId: '1', host: 'shop.example.com', exp: expiresAt }),
        'utf8',
    ).toString('base64url');
    return `${payload}.test-signature`;
}

function browserHarness(initialTicket: string, refreshedTicket = entryTicket(Date.now() + 60_000)) {
    let submitListener: ((event: { preventDefault: () => void }) => void) | undefined;
    const attributes = new Map<string, string>();
    const ticketInput = { value: initialTicket };
    const button = { disabled: false, setAttribute: vi.fn() };
    const form = {
        addEventListener: vi.fn((type: string, listener: typeof submitListener) => {
            if (type === 'submit') submitListener = listener;
        }),
        getAttribute: vi.fn((name: string) => attributes.get(name) ?? null),
        querySelector: vi.fn((selector: string) =>
            selector.includes('input[name="ticket"]') ? ticketInput : button,
        ),
        setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
    };
    const documentMock = {
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn((selector: string) =>
            selector === 'form[data-store-entry]' ? [form] : [ticketInput],
        ),
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('<html>') });
    const nativeSubmit = vi.fn();
    const location = { assign: vi.fn() };
    class DocumentParserMock {
        parseFromString() {
            return { querySelector: () => ({ value: refreshedTicket }) };
        }
    }

    runInNewContext(PROMOTION_VISUAL_SCRIPT, {
        DOMParser: DocumentParserMock,
        HTMLFormElement: { prototype: { submit: nativeSubmit } },
        atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
        document: documentMock,
        fetch: fetchMock,
        location,
    });

    return {
        button,
        dispatchSubmit: (preventDefault = vi.fn()) => {
            if (!submitListener) throw new Error('Promotion entry submit listener was not installed');
            submitListener({ preventDefault });
            return preventDefault;
        },
        fetchMock,
        form,
        location,
        nativeSubmit,
        ticketInput,
    };
}

describe('promotion visual entry recovery', () => {
    it('refreshes an expired ticket and continues the original form submission', async () => {
        const refreshedTicket = entryTicket(Date.now() + 60_000);
        const harness = browserHarness(entryTicket(Date.now() - 1), refreshedTicket);

        const preventDefault = harness.dispatchSubmit();

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(harness.button.disabled).toBe(true);
        expect(harness.button.setAttribute).toHaveBeenCalledWith('aria-busy', 'true');
        expect(harness.fetchMock).toHaveBeenCalledWith('/promo', {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { Accept: 'text/html' },
        });
        await vi.waitFor(() => expect(harness.nativeSubmit).toHaveBeenCalledOnce());
        expect(harness.ticketInput.value).toBe(refreshedTicket);
        expect(harness.nativeSubmit.mock.contexts[0]).toBe(harness.form);
        expect(harness.location.assign).not.toHaveBeenCalled();
    });

    it('leaves a valid ticket submission on the browser native path', () => {
        const harness = browserHarness(entryTicket(Date.now() + 60_000));

        const preventDefault = harness.dispatchSubmit();

        expect(preventDefault).not.toHaveBeenCalled();
        expect(harness.fetchMock).not.toHaveBeenCalled();
        expect(harness.nativeSubmit).not.toHaveBeenCalled();
    });

    it('returns to the promotion page when a ticket refresh fails', async () => {
        const harness = browserHarness(entryTicket(Date.now() - 1));
        harness.fetchMock.mockRejectedValueOnce(new Error('offline'));

        harness.dispatchSubmit();

        await vi.waitFor(() => expect(harness.location.assign).toHaveBeenCalledWith('/promo'));
        expect(harness.nativeSubmit).not.toHaveBeenCalled();
    });
});
