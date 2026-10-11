import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import { catalogReferenceRequest, resolveCatalogReferences } from './catalog-references';

describe('complete saved catalog identities', () => {
    it('resolves every saved identity in independent batches of 100 and keeps original order', () => {
        const ids = Array.from({ length: 205 }, (_, index) => String(index + 1));
        const request = catalogReferenceRequest([...ids, '1'], 'products');
        expect(Object.values(request.variables).map(batch => batch.length)).toEqual([100, 100, 5]);
        expect(print(request.document)).toContain('batch2: products');
        expect(catalogReferenceRequest(ids, 'products').document).toBe(request.document);
        const data = Object.fromEntries(
            request.batches.map((batch, index) => [
                `batch${index}`,
                {
                    totalItems: batch.length,
                    items: [...batch].reverse().map(id => ({ id, name: id, enabled: true })),
                },
            ]),
        );
        expect(resolveCatalogReferences(request.batches, data).map(reference => reference.id)).toEqual(ids);
    });
    it('keeps eight identities after two become unavailable, then restores their original positions', () => {
        const ids = Array.from({ length: 8 }, (_, index) => String(index));
        const request = catalogReferenceRequest(ids, 'products');
        const items = ids.filter(id => !['1', '5'].includes(id)).map(id => ({ id, name: id, enabled: true }));
        const deleted = resolveCatalogReferences(request.batches, { batch0: { totalItems: 6, items } });
        expect(deleted.filter(reference => reference.state === 'available')).toHaveLength(6);
        expect(
            deleted.filter(reference => reference.state === 'unavailable').map(reference => reference.id),
        ).toEqual(['1', '5']);
        expect(deleted.map(reference => reference.id)).toEqual(ids);
        const restored = resolveCatalogReferences(request.batches, {
            batch0: { totalItems: 8, items: ids.map(id => ({ id, name: `new ${id}` })) },
        });
        expect(restored.map(reference => reference.entity?.name)).toEqual(ids.map(id => `new ${id}`));
    });
    it('treats failures, missing fields and truncated batches as unknown instead of deleting associations', () => {
        const request = catalogReferenceRequest(['sku-a', 'sku-b'], 'productVariants');
        for (const result of [
            undefined,
            {},
            { batch0: { items: [{ id: 'sku-a', name: 'A' }], totalItems: 2 } },
        ])
            expect(
                resolveCatalogReferences(request.batches, result).map(reference => reference.state),
            ).toEqual(['unknown', 'unknown']);
        expect(
            resolveCatalogReferences(request.batches, { batch0: { items: [], totalItems: 0 } }, true).map(
                reference => reference.state,
            ),
        ).toEqual(['unknown', 'unknown']);
        expect(
            resolveCatalogReferences(request.batches, {
                batch0: { items: [{ id: 'sku-a', name: 'A', enabled: false }], totalItems: 1 },
            }).map(reference => reference.state),
        ).toEqual(['unavailable', 'unavailable']);
    });
    it('keeps successful batches authoritative when one sibling batch fails', () => {
        const ids = Array.from({ length: 205 }, (_, index) => String(index));
        const { batches } = catalogReferenceRequest(ids, 'products');
        const data = Object.fromEntries(
            batches.map((batch, index) => [
                `batch${index}`,
                { items: batch.map(id => ({ id, name: id })), totalItems: batch.length },
            ]),
        );
        const result = resolveCatalogReferences(batches, data, ['batch1']);
        expect(result.filter(reference => reference.state === 'available')).toHaveLength(105);
        expect(
            result.filter(reference => reference.state === 'unknown').map(reference => reference.id),
        ).toEqual(ids.slice(100, 200));
        expect(result.filter(reference => reference.state === 'unavailable')).toEqual([]);
    });
});
