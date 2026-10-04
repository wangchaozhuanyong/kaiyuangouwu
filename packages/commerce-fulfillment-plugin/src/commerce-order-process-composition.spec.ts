import { defaultConfig, defaultOrderProcess, mergeConfig } from '@vendure/core';
import 'reflect-metadata';
import { expect, it, vi } from 'vitest';

import { storefrontCartOrderProcess } from '../../storefront-cart-plugin/src/storefront-cart-order-process';

import { composeCommerceOrderProcesses } from './commerce-order-process-composition';

it('retains cart and third-party guards while replacing only the standard default process', async () => {
    const custom = { onTransitionStart: vi.fn(() => 'custom guard') };
    const processes = composeCommerceOrderProcesses([
        defaultOrderProcess,
        storefrontCartOrderProcess,
        custom,
    ]);
    expect(processes).toContain(storefrontCartOrderProcess);
    expect(processes).toContain(custom);
    expect(processes).not.toContain(defaultOrderProcess);
    const findOne = vi
        .fn()
        .mockResolvedValueOnce({ id: 'cart', revision: 2, lines: [] })
        .mockResolvedValueOnce(null);
    await storefrontCartOrderProcess.init?.({ get: () => ({ getRepository: () => ({ findOne }) }) } as any);
    const guard = processes.find(process => process === storefrontCartOrderProcess);
    if (!guard?.onTransitionStart) throw new Error('Cart guard missing from composed processes');
    await expect(
        (guard.onTransitionStart as any)('AddingItems', 'ArrangingPayment', {
            ctx: { channelId: 'store' },
            order: { id: 'order', lines: [] },
        }),
    ).resolves.toMatch(/must be prepared/);
});

it('recognizes a cloned bootstrap default without deleting an overridden guard', () => {
    const copied = mergeConfig(defaultConfig, {});
    const original = copied.orderOptions.process?.[0];
    expect(original).not.toBe(defaultOrderProcess);
    const custom = { ...original, onTransitionStart: vi.fn(() => 'custom requirement') };
    const composed = composeCommerceOrderProcesses([...(copied.orderOptions.process ?? []), custom]);
    expect(composed).not.toContain(original);
    expect(composed).toContain(custom);
});
