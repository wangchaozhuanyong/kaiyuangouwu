import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { CartRevisionConflictError } from './storefront-cart.errors';
import {
    StorefrontCartEntityResolver,
    StorefrontCartShopResolver,
} from './storefront-cart.resolver';

function createCart(lines: Array<Pick<StorefrontCartLine, 'quantity' | 'selected'>>): StorefrontCart {
    return new StorefrontCart({ lines: lines.map(line => new StorefrontCartLine(line)) });
}

describe('StorefrontCart GraphQL fields', () => {
    const resolver = new StorefrontCartEntityResolver();

    it('reports an empty cart as unselected', () => {
        const cart = createCart([]);

        expect(resolver.totalQuantity(cart)).toBe(0);
        expect(resolver.selectedLineCount(cart)).toBe(0);
        expect(resolver.selectedQuantity(cart)).toBe(0);
        expect(resolver.selectionState(cart)).toBe('NONE');
    });

    it('distinguishes partial and complete selection using lines and quantities', () => {
        const partialCart = createCart([
            { quantity: 2, selected: true },
            { quantity: 3, selected: false },
        ]);
        const completeCart = createCart([
            { quantity: 2, selected: true },
            { quantity: 3, selected: true },
        ]);

        expect(resolver.totalQuantity(partialCart)).toBe(5);
        expect(resolver.selectedLineCount(partialCart)).toBe(1);
        expect(resolver.selectedQuantity(partialCart)).toBe(2);
        expect(resolver.selectionState(partialCart)).toBe('PARTIAL');
        expect(resolver.selectionState(completeCart)).toBe('ALL');
    });

    it('provides concrete union type names for success and errors', () => {
        const conflict = new CartRevisionConflictError(3, 4);

        expect(createCart([]).__typename).toBe('StorefrontCart');
        expect(conflict).toMatchObject({
            __typename: 'CartRevisionConflictError',
            errorCode: 'CART_REVISION_CONFLICT_ERROR',
            expectedRevision: 3,
            actualRevision: 4,
        });
    });
});

describe('StorefrontCart mutation transactions', () => {
    const ctx = {} as any;

    it('commits a successful projection and assigns the active order', async () => {
        const cart = createCart([]);
        const service = {
            addItem: vi.fn().mockResolvedValue(cart),
            syncActiveOrderSession: vi.fn().mockResolvedValue(undefined),
        };
        const connection = {
            startTransaction: vi.fn().mockResolvedValue(undefined),
            commitOpenTransaction: vi.fn().mockResolvedValue(undefined),
            rollBackTransaction: vi.fn().mockResolvedValue(undefined),
        };
        const resolver = new StorefrontCartShopResolver(service as any, connection as any);

        await resolver.addStorefrontCartItem(ctx, {
            input: { productVariantId: '1', quantity: 1 },
            expectedRevision: 0,
        });

        expect(connection.startTransaction).toHaveBeenCalledWith(ctx);
        expect(service.syncActiveOrderSession).toHaveBeenCalledWith(ctx, cart);
        expect(connection.commitOpenTransaction).toHaveBeenCalledWith(ctx);
        expect(connection.rollBackTransaction).not.toHaveBeenCalled();
    });

    it('rolls back a structured error without assigning an active order', async () => {
        const conflict = new CartRevisionConflictError(0, 1);
        const service = {
            addItem: vi.fn().mockResolvedValue(conflict),
            syncActiveOrderSession: vi.fn().mockResolvedValue(undefined),
        };
        const connection = {
            startTransaction: vi.fn().mockResolvedValue(undefined),
            commitOpenTransaction: vi.fn().mockResolvedValue(undefined),
            rollBackTransaction: vi.fn().mockResolvedValue(undefined),
        };
        const resolver = new StorefrontCartShopResolver(service as any, connection as any);

        const result = await resolver.addStorefrontCartItem(ctx, {
            input: { productVariantId: '1', quantity: 1 },
            expectedRevision: 0,
        });

        expect(result).toBe(conflict);
        expect(connection.rollBackTransaction).toHaveBeenCalledWith(ctx);
        expect(service.syncActiveOrderSession).not.toHaveBeenCalled();
        expect(connection.commitOpenTransaction).not.toHaveBeenCalled();
    });
});
