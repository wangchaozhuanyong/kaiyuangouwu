import { describe, expect, it } from 'vitest';

import { calculateAutoUnpack } from './product-packaging-calculation';

describe('calculateAutoUnpack', () => {
    it('does not open a package when loose units cover the order', () => {
        expect(
            calculateAutoUnpack({
                unitDemand: 5,
                packageDemand: 0,
                unitStockOnHand: 6,
                unitStockAllocated: 0,
                unitOutOfStockThreshold: 0,
                packageStockOnHand: 10,
                packageStockAllocated: 0,
                packageOutOfStockThreshold: 0,
                unitsPerPackage: 24,
            }),
        ).toMatchObject({ packagesToOpen: 0, unitsCreated: 0, sufficient: true });
    });

    it('opens the minimum package count and preserves loose remainder', () => {
        expect(
            calculateAutoUnpack({
                unitDemand: 30,
                packageDemand: 0,
                unitStockOnHand: 3,
                unitStockAllocated: 0,
                unitOutOfStockThreshold: 0,
                packageStockOnHand: 10,
                packageStockAllocated: 0,
                packageOutOfStockThreshold: 0,
                unitsPerPackage: 24,
            }),
        ).toMatchObject({ packagesToOpen: 2, unitsCreated: 48, sufficient: true });
    });

    it('reserves packages explicitly purchased in the same order', () => {
        expect(
            calculateAutoUnpack({
                unitDemand: 1,
                packageDemand: 1,
                unitStockOnHand: 0,
                unitStockAllocated: 0,
                unitOutOfStockThreshold: 0,
                packageStockOnHand: 1,
                packageStockAllocated: 0,
                packageOutOfStockThreshold: 0,
                unitsPerPackage: 24,
            }),
        ).toMatchObject({ packagesToOpen: 1, packageAvailableAfterOrder: -1, sufficient: false });
    });

    it('respects allocated inventory and stock thresholds', () => {
        expect(
            calculateAutoUnpack({
                unitDemand: 24,
                packageDemand: 0,
                unitStockOnHand: 4,
                unitStockAllocated: 2,
                unitOutOfStockThreshold: 2,
                packageStockOnHand: 3,
                packageStockAllocated: 1,
                packageOutOfStockThreshold: 1,
                unitsPerPackage: 24,
            }),
        ).toMatchObject({
            unitAvailableBeforeUnpack: 0,
            packageAvailableBeforeUnpack: 1,
            packagesToOpen: 1,
            sufficient: true,
        });
    });

    it('does not treat a negative package threshold as a physical package to open', () => {
        expect(
            calculateAutoUnpack({
                unitDemand: 1,
                packageDemand: 0,
                unitStockOnHand: 0,
                unitStockAllocated: 0,
                unitOutOfStockThreshold: 0,
                packageStockOnHand: 0,
                packageStockAllocated: 0,
                packageOutOfStockThreshold: -1,
                unitsPerPackage: 24,
            }),
        ).toMatchObject({ packagesToOpen: 1, packageAvailableBeforeUnpack: 0, sufficient: false });
    });

    it('opens enough stock to preserve the loose-unit threshold after unpacking', () => {
        expect(
            calculateAutoUnpack({
                unitDemand: 24,
                packageDemand: 0,
                unitStockOnHand: 0,
                unitStockAllocated: 0,
                unitOutOfStockThreshold: 1,
                packageStockOnHand: 2,
                packageStockAllocated: 0,
                packageOutOfStockThreshold: 0,
                unitsPerPackage: 24,
            }),
        ).toMatchObject({ packagesToOpen: 2, unitsCreated: 48, sufficient: true });
    });
});
