export interface CustomerAddressInputForm {
    fullName: string;
    company: string;
    streetLine1: string;
    streetLine2: string;
    city: string;
    province: string;
    postalCode: string;
    countryCode: string;
    phoneNumber: string;
    defaultShippingAddress: boolean;
    defaultBillingAddress: boolean;
}

/**
 * Address text columns have empty-string defaults in Vendure's Address entity.
 * Send empty strings for blank optional fields so GraphQL nulls do not override
 * those database defaults and violate the non-null columns.
 */
export function toCustomerAddressInput(form: CustomerAddressInputForm) {
    return {
        fullName: form.fullName.trim(),
        company: form.company.trim(),
        streetLine1: form.streetLine1.trim(),
        streetLine2: form.streetLine2.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        postalCode: form.postalCode.trim(),
        countryCode: form.countryCode,
        phoneNumber: form.phoneNumber.trim(),
        defaultShippingAddress: form.defaultShippingAddress,
        defaultBillingAddress: form.defaultBillingAddress,
    };
}
