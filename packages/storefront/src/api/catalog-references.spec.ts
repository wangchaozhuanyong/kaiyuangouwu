import { describe, expect, it, vi } from 'vitest';

import { CatalogApi } from './catalog';
import { type ShopApiContext } from './client-context';

type ReferenceVariables = { options: { filter: { id: { in: string[] } } } };

function referenceFixture() {
    const observedContexts: ShopApiContext[] = [];
    const request = vi.fn(function (
        this: ShopApiContext,
        _document: string,
        variables?: ReferenceVariables,
        _signal?: AbortSignal,
    ) {
        observedContexts.push(this);
        const items = [...(variables?.options.filter.id.in ?? [])].reverse().map(id => ({ id }));
        return Promise.resolve({ products: { items, totalItems: items.length } });
    });
    const context = { request } as unknown as ShopApiContext;
    return { api: new CatalogApi(context), request, context, observedContexts };
}

describe('complete public product identities', () => {
    it('batches 205 identities, preserves order, and never replaces a missing identity', async () => {
        const ids = Array.from({ length: 205 }, (_, index) => `p-${index}`);
        const request = vi.fn((_document: string, variables: any, _signal?: AbortSignal) => {
            const batch = variables.options.filter.id.in as string[];
            const items = [...batch]
                .reverse()
                .filter(id => id !== 'p-3')
                .map(id => ({ id }));
            return Promise.resolve({ products: { items, totalItems: items.length } });
        });
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        const signal = new AbortController().signal;
        expect((await api.productsByIds([...ids, 'p-0'], signal)).map(product => product.id)).toEqual(
            ids.filter(id => id !== 'p-3'),
        );
        expect(request.mock.calls.map(call => call[1].options.take)).toEqual([100, 100, 5]);
        expect(request.mock.calls.every(call => call[2] === signal)).toBe(true);
    });
    it('rejects a failed or incomplete batch instead of publishing a partial authoritative list', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ products: { items: [{ id: 'p-0' }], totalItems: 1 } })
            .mockRejectedValueOnce(new Error('network'));
        const api = new CatalogApi({ request } as unknown as ShopApiContext);
        await expect(
            api.productsByIds(Array.from({ length: 101 }, (_, index) => `p-${index}`)),
        ).rejects.toThrow('network');
        request.mockReset().mockResolvedValue({ products: { items: [], totalItems: 1 } });
        await expect(api.productsByIds(['p-0'])).rejects.toThrow('incomplete');
    });
    it('returns an empty read before cancellation and preserves nonempty caller abort reasons', async () => {
        const { api, request } = referenceFixture();
        const controller = new AbortController();
        const reason = new Error('Fixture cancelled before read');
        controller.abort(reason);
        await expect(api.productsByIds([])).resolves.toEqual([]);
        await expect(api.productsByIds([], controller.signal)).resolves.toEqual([]);
        await expect(api.productsByIds(['p-0'], controller.signal)).rejects.toBe(reason);
        expect(request).not.toHaveBeenCalled();
    });

    it('does not delegate after cancellation during asynchronous native reader admission', async () => {
        const { api, request } = referenceFixture();
        const controller = new AbortController();
        const reason = new Error('Fixture cancelled during reader admission');
        const pending = api.productsByIds(['p-0'], controller.signal);
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(request).not.toHaveBeenCalled();
    });

    it('snapshots input identities before the first asynchronous reader boundary', async () => {
        const { api, request } = referenceFixture();
        const ids = ['p-2', 'p-1', 'p-2'];
        const pending = api.productsByIds(ids);
        ids.splice(0, ids.length, 'p-9');
        await expect(pending).resolves.toEqual([{ id: 'p-2' }, { id: 'p-1' }]);
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][1]?.options.filter.id.in).toEqual(['p-2', 'p-1']);
    });

    it('keeps concurrent and subsequent callers on the original context without sharing cancellation', async () => {
        const { api, request, context, observedContexts } = referenceFixture();
        const cancelled = new AbortController();
        const live = new AbortController();
        const next = new AbortController();
        const reason = new Error('Fixture cancelled one concurrent caller');
        const cancelledRead = api.productsByIds(['cancelled'], cancelled.signal);
        const liveRead = api.productsByIds(['live'], live.signal);
        cancelled.abort(reason);
        await expect(cancelledRead).rejects.toBe(reason);
        await expect(liveRead).resolves.toEqual([{ id: 'live' }]);
        await expect(api.productsByIds(['next'], next.signal)).resolves.toEqual([{ id: 'next' }]);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.map(call => call[1]?.options.filter.id.in)).toEqual([['live'], ['next']]);
        expect(request.mock.calls.map(call => call[2])).toEqual([live.signal, next.signal]);
        expect(observedContexts).toHaveLength(2);
        expect(observedContexts.every(observed => observed === context)).toBe(true);
    });
});
