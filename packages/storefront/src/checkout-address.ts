import type { ActiveCustomer, CustomerAddress, CustomerAddressInput } from './types';

export function checkoutAddress(customer: ActiveCustomer | null, addressId?: string): CustomerAddress | null {
    return (
        customer?.addresses?.find(address => address.id === addressId) ??
        customer?.addresses?.find(address => address.defaultShippingAddress) ??
        customer?.addresses?.[0] ??
        null
    );
}

export function shippingAddressInput(
    address: CustomerAddress | null,
    countryCode = '',
): CustomerAddressInput {
    return {
        fullName: address?.fullName ?? '',
        phoneNumber: address?.phoneNumber ?? '',
        countryCode: address?.country.code ?? countryCode,
        province: address?.province ?? '',
        city: address?.city ?? '',
        streetLine1: address?.streetLine1 ?? '',
        streetLine2: address?.streetLine2 ?? '',
        postalCode: address?.postalCode ?? '',
    };
}

export function isCompleteShippingAddress(address: CustomerAddress | null): boolean {
    const { streetLine2: _optional, ...required } = shippingAddressInput(address);
    return Object.values(required).every(value => typeof value === 'string' && value.trim().length > 0);
}
