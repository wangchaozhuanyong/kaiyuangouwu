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

describe('promotion navigation position', () => {
    function navigationHarness() {
        const frames: Array<() => void> = [];
        const events = new Map<string, () => void>();
        const positions = new Map<string, { top: number; bottom: number }>([
            ['shopping', { top: 700, bottom: 1400 }],
            ['visa', { top: 1400, bottom: 2466 }],
            ['ai', { top: 2466, bottom: 3200 }],
        ]);
        const links = [...positions.keys()].map(id => {
            const attributes = new Map([['href', `#${id}`]]);
            const classes = new Set<string>();
            return {
                id,
                attributes,
                classes,
                getAttribute: (name: string) => attributes.get(name),
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                removeAttribute: (name: string) => attributes.delete(name),
                classList: {
                    toggle: (name: string, enabled: boolean) =>
                        enabled ? classes.add(name) : classes.delete(name),
                },
            };
        });
        const header = { classList: { add: vi.fn() }, getBoundingClientRect: () => ({ bottom: 100 }) };
        const page = { setAttribute: vi.fn() };
        const documentMock = {
            documentElement: { classList: { add: vi.fn() } },
            querySelector: (selector: string) => {
                if (selector === '[data-promo-motion]') return page;
                if (selector === '[data-promo-header]') return header;
                if (selector.startsWith('#') && positions.has(selector.slice(1))) {
                    return { getBoundingClientRect: () => positions.get(selector.slice(1)) };
                }
                return null;
            },
            querySelectorAll: (selector: string) => (selector === '.promo-nav a[href^="#"]' ? links : []),
            addEventListener: vi.fn(),
        };
        runInNewContext(PROMOTION_VISUAL_SCRIPT, {
            document: documentMock,
            window: { addEventListener: (name: string, callback: () => void) => events.set(name, callback) },
            matchMedia: () => ({ matches: true }),
            requestAnimationFrame: (callback: () => void) => frames.push(callback),
        });
        const flush = () => {
            while (frames.length) frames.shift()?.();
        };
        flush();
        return { links, positions, events, frames, flush };
    }

    it('selects a tall visa section at the reading line instead of retaining a previous section', () => {
        const h = navigationHarness();
        expect(h.links.every(link => !link.classes.has('is-active'))).toBe(true);
        h.positions.set('shopping', { top: -577, bottom: 132 });
        h.positions.set('visa', { top: 132, bottom: 1198 });
        h.positions.set('ai', { top: 1198, bottom: 1931 });
        h.events.get('scroll')?.();
        h.flush();

        expect(h.links.filter(link => link.classes.has('is-active')).map(link => link.id)).toEqual(['visa']);
        expect(h.links[1].attributes.get('aria-current')).toBe('location');
        expect(h.links[0].attributes.has('aria-current')).toBe(false);
    });

    it('coalesces scroll updates and clears the active service after the service sections end', () => {
        const h = navigationHarness();
        h.positions.set('shopping', { top: -2000, bottom: -1300 });
        h.positions.set('visa', { top: -1300, bottom: -234 });
        h.positions.set('ai', { top: -234, bottom: 499 });
        h.events.get('scroll')?.();
        h.events.get('scroll')?.();
        expect(h.frames).toHaveLength(1);
        h.flush();
        expect(h.links[2].attributes.get('aria-current')).toBe('location');

        h.positions.set('ai', { top: -800, bottom: -67 });
        h.events.get('resize')?.();
        h.flush();
        expect(
            h.links.every(link => !link.classes.has('is-active') && !link.attributes.has('aria-current')),
        ).toBe(true);
    });
});
