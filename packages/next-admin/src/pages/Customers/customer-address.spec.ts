import { describe, expect, it } from 'vitest';

import { toCustomerAddressInput, type CustomerAddressInputForm } from './customer-address';

const emptyAddressForm: CustomerAddressInputForm = {
    fullName: '',
    company: '',
    streetLine1: '  QA Street 1  ',
    streetLine2: '',
    city: '',
    province: '',
    postalCode: '',
    countryCode: 'CN',
    phoneNumber: '',
    defaultShippingAddress: true,
    defaultBillingAddress: false,
};

describe('customer address input', () => {
    it('sends blank optional address columns as empty strings instead of null', () => {
        expect(toCustomerAddressInput(emptyAddressForm)).toEqual({
            fullName: '',
            company: '',
            streetLine1: 'QA Street 1',
            streetLine2: '',
            city: '',
            province: '',
            postalCode: '',
            countryCode: 'CN',
            phoneNumber: '',
            defaultShippingAddress: true,
            defaultBillingAddress: false,
        });
    });

    it('trims populated address fields and preserves the selected default flags', () => {
        expect(
            toCustomerAddressInput({
                ...emptyAddressForm,
                company: '  QA Company  ',
                streetLine2: '  Suite 2  ',
                city: '  Test City  ',
                province: '  Test Province  ',
                postalCode: '  000000  ',
                phoneNumber: '  +60123456789  ',
                defaultShippingAddress: false,
                defaultBillingAddress: true,
            }),
        ).toMatchObject({
            company: 'QA Company',
            streetLine2: 'Suite 2',
            city: 'Test City',
            province: 'Test Province',
            postalCode: '000000',
            phoneNumber: '+60123456789',
            defaultShippingAddress: false,
            defaultBillingAddress: true,
        });
    });
});
