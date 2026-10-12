import { describe, expect, it, vi } from 'vitest';

import { type StorefrontCart } from '../types';

import { CartReadInvalidatedError, CartRepository } from './cart-repository';

const cart: StorefrontCart = {
    id: 'cart-a',
    revision: 87,
    projectedRevision: 87,
    state: 'OPEN',
    totalQuantity: 0,
    selectedQuantity: 0,
    selectedLineCount: 0,
    selectionState: 'NONE',
    checkoutOrder: null,
    lines: [],
};

function repositoryRead(normalizeAbort = false) {
    const repository = new CartRepository();
    repository.accept(cart);
    let finish!: (cart: StorefrontCart) => void;
    let signal!: AbortSignal;
    const read = vi.fn(
        (transportSignal?: AbortSignal) =>
            new Promise<StorefrontCart>((resolve, reject) => {
                if (!transportSignal) throw new Error('Missing repository transport signal');
                signal = transportSignal;
                finish = resolve;
                if (normalizeAbort)
                    signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        { once: true },
                    );
            }),
    );
    repository.setTransport({ read, apply: vi.fn(), recover: vi.fn() });
    return { repository, read, finish: (value: StorefrontCart) => finish(value), signal: () => signal };
}

describe('cart display read cancellation identity', () => {
    it.each([false, true])(
        'marks only write invalidation and rejects late data: normalized=%s',
        async normalizeAbort => {
            const fixture = repositoryRead(normalizeAbort);
            const reading = fixture.repository.read().catch(failure => failure);
            fixture.repository.invalidateReads();
            const latest = { ...cart, revision: 88 };
            fixture.repository.accept(latest);
            fixture.finish(cart);
            const error: unknown = await reading;
            expect(error).toBeInstanceOf(CartReadInvalidatedError);
            expect(error).toMatchObject({ name: 'AbortError' });
            expect(fixture.signal().reason).toBe(error);
            expect(fixture.repository.snapshot).toBe(latest);
            fixture.read.mockImplementationOnce(() => Promise.resolve(latest));
            expect(await fixture.repository.read()).toBe(latest);
        },
    );

    it('keeps a session reset distinct from write invalidation', async () => {
        const fixture = repositoryRead();
        const reading = fixture.repository.read().catch(failure => failure);
        fixture.repository.reset();
        fixture.finish(cart);
        const error: unknown = await reading;
        expect(error).toMatchObject({ name: 'AbortError' });
        expect(error).not.toBeInstanceOf(CartReadInvalidatedError);
        expect(fixture.repository.snapshot).toBeNull();
    });

    it('keeps cancellation by an external owner distinct from write invalidation', async () => {
        const fixture = repositoryRead();
        const owner = new AbortController();
        const reading = fixture.repository.read(owner.signal).catch(error => error);
        const cancelled = new DOMException('Route cancelled', 'AbortError');
        owner.abort(cancelled);
        expect(await reading).toBe(cancelled);
        expect(cancelled).not.toBeInstanceOf(CartReadInvalidatedError);
        expect(fixture.signal().aborted).toBe(true);
        fixture.finish(cart);
    });
});
