import { OrderAddress } from '@vendure/common/lib/generated-types';
import { Order, OrderLine, RequestContext } from '@vendure/core';

import { DigitalDeliveryMode } from './auto-card.constants';
import { FulfillmentType } from './types';

export interface CheckoutFulfillmentSummary {
    fulfillmentType: 'PHYSICAL' | 'DIGITAL' | 'MIXED';
    containsPhysicalProducts: boolean;
    containsDigitalProducts: boolean;
    requiresShippingAddress: boolean;
    requiresShippingMethod: boolean;
}

export function getOrderLineFulfillmentType(line: OrderLine): FulfillmentType {
    return (
        line.customFields?.fulfillmentTypeSnapshot ??
        line.productVariant?.customFields?.fulfillmentType ??
        'physical'
    );
}

export function getOrderLineDigitalDeliveryMode(line: OrderLine): DigitalDeliveryMode {
    return (
        line.customFields?.digitalDeliveryModeSnapshot ??
        line.productVariant?.customFields?.digitalDeliveryMode ??
        'file_download'
    );
}

export function isAutoCardOrderLine(line: OrderLine): boolean {
    return (
        getOrderLineFulfillmentType(line) === 'digital' &&
        getOrderLineDigitalDeliveryMode(line) === 'auto_card'
    );
}

export function summarizeOrderFulfillment(order: Pick<Order, 'lines'>): CheckoutFulfillmentSummary {
    const containsPhysicalProducts = order.lines.some(
        line => getOrderLineFulfillmentType(line) === 'physical',
    );
    const containsDigitalProducts = order.lines.some(line => getOrderLineFulfillmentType(line) === 'digital');

    return {
        fulfillmentType:
            containsPhysicalProducts && containsDigitalProducts
                ? 'MIXED'
                : containsDigitalProducts
                  ? 'DIGITAL'
                  : 'PHYSICAL',
        containsPhysicalProducts,
        containsDigitalProducts,
        requiresShippingAddress: containsPhysicalProducts,
        requiresShippingMethod: containsPhysicalProducts,
    };
}

export function hasCompleteShippingAddress(ctx: RequestContext, address?: OrderAddress): boolean {
    if (!address) {
        return false;
    }
    const requiredValues = [
        address.fullName,
        address.streetLine1,
        address.city,
        address.province,
        address.postalCode,
        address.countryCode,
        address.phoneNumber,
    ];
    if (requiredValues.some(value => !value?.trim())) {
        return false;
    }

    const expectedCountryCode = getExpectedCountryCode(ctx.channel.code);
    const countryCode = address.countryCode;
    return expectedCountryCode && countryCode ? countryCode.toUpperCase() === expectedCountryCode : true;
}

function getExpectedCountryCode(channelCode: string): 'CN' | 'MY' | undefined {
    if (channelCode === 'cn-mainland') {
        return 'CN';
    }
    if (channelCode === 'my-malaysia') {
        return 'MY';
    }
}
