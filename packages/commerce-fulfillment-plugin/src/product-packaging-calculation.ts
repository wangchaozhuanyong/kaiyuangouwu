export interface AutoUnpackCalculationInput {
    unitDemand: number;
    packageDemand: number;
    unitStockOnHand: number;
    unitStockAllocated: number;
    unitOutOfStockThreshold: number;
    packageStockOnHand: number;
    packageStockAllocated: number;
    packageOutOfStockThreshold: number;
    unitsPerPackage: number;
}

export interface AutoUnpackCalculation {
    packagesToOpen: number;
    unitsCreated: number;
    unitAvailableBeforeUnpack: number;
    packageAvailableBeforeUnpack: number;
    packageAvailableAfterOrder: number;
    sufficient: boolean;
}

export function calculateAutoUnpack(input: AutoUnpackCalculationInput): AutoUnpackCalculation {
    const unitAvailableBeforeUnpack = Math.max(
        input.unitStockOnHand - input.unitStockAllocated - input.unitOutOfStockThreshold,
        0,
    );
    const physicalPackageThreshold = Math.max(input.packageOutOfStockThreshold, 0);
    const packageAvailableBeforeUnpack = Math.max(
        input.packageStockOnHand - input.packageStockAllocated - physicalPackageThreshold,
        0,
    );
    const unitShortage = Math.max(
        input.unitDemand + input.unitStockAllocated + input.unitOutOfStockThreshold - input.unitStockOnHand,
        0,
    );
    const packagesToOpen = unitShortage === 0 ? 0 : Math.ceil(unitShortage / input.unitsPerPackage);
    const packageAvailableAfterOrder = packageAvailableBeforeUnpack - input.packageDemand - packagesToOpen;

    return {
        packagesToOpen,
        unitsCreated: packagesToOpen * input.unitsPerPackage,
        unitAvailableBeforeUnpack,
        packageAvailableBeforeUnpack,
        packageAvailableAfterOrder,
        sufficient:
            input.unitsPerPackage >= 2 &&
            input.packageDemand <= packageAvailableBeforeUnpack &&
            packageAvailableAfterOrder >= 0,
    };
}
