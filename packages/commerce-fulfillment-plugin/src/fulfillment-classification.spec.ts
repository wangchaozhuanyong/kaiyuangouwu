import { describe, expect, it } from 'vitest';

import {
    getOrderLineDigitalDeliveryMode,
    hasCompleteShippingAddress,
    isAutoCardOrderLine,
    isFileDownloadOrderLine,
    isManualServiceOrderLine,
    summarizeOrderFulfillment,
} from './fulfillment-classification';

function line(type: 'physical' | 'digital') {
    return {
        customFields: { fulfillmentTypeSnapshot: type },
        productVariant: { customFields: { fulfillmentType: type } },
    } as any;
}

describe('summarizeOrderFulfillment', () => {
    it('does not require address or shipping for a digital-only order', () => {
        expect(summarizeOrderFulfillment({ lines: [line('digital')] } as any)).toEqual({
            fulfillmentType: 'DIGITAL',
            containsPhysicalProducts: false,
            containsDigitalProducts: true,
            requiresShippingAddress: false,
            requiresShippingMethod: false,
        });
    });

    it('requires address and shipping for a mixed order', () => {
        expect(summarizeOrderFulfillment({ lines: [line('digital'), line('physical')] } as any)).toEqual({
            fulfillmentType: 'MIXED',
            containsPhysicalProducts: true,
            containsDigitalProducts: true,
            requiresShippingAddress: true,
            requiresShippingMethod: true,
        });
    });
});

describe('digital delivery modes', () => {
    it('defaults digital products to manual merchant processing', () => {
        const orderLine = line('digital');

        expect(getOrderLineDigitalDeliveryMode(orderLine)).toBe('manual_service');
        expect(isManualServiceOrderLine(orderLine)).toBe(true);
        expect(isFileDownloadOrderLine(orderLine)).toBe(false);
        expect(isAutoCardOrderLine(orderLine)).toBe(false);
    });

    it('keeps explicit file downloads and auto-card lines separate', () => {
        const download = line('digital');
        download.customFields.digitalDeliveryModeSnapshot = 'file_download';
        const autoCard = line('digital');
        autoCard.customFields.digitalDeliveryModeSnapshot = 'auto_card';

        expect(isFileDownloadOrderLine(download)).toBe(true);
        expect(isAutoCardOrderLine(autoCard)).toBe(true);
        expect(isManualServiceOrderLine(download)).toBe(false);
        expect(isManualServiceOrderLine(autoCard)).toBe(false);
    });
});

describe('hasCompleteShippingAddress', () => {
    const completeAddress = {
        fullName: '测试用户',
        streetLine1: '南京西路 100 号',
        city: '上海市',
        province: '上海市',
        postalCode: '200000',
        countryCode: 'CN',
        phoneNumber: '13800000000',
    } as any;

    it('accepts a complete shipping address', () => {
        expect(hasCompleteShippingAddress(completeAddress)).toBe(true);
    });

    it('leaves destination eligibility to configured shipping methods', () => {
        expect(hasCompleteShippingAddress({ ...completeAddress, countryCode: 'MY' })).toBe(true);
        expect(hasCompleteShippingAddress({ ...completeAddress, postalCode: '' })).toBe(false);
    });
});
