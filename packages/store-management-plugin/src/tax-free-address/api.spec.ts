import { Permission } from '@vendure/core';
import 'reflect-metadata';
import { expect, it } from 'vitest';

import { TaxFreeAddressAdminResolver } from './plugin';

it('requires SuperAdmin for every address pool GraphQL operation', () => {
    for (const name of [
        'taxFreeAddresses',
        'generateTaxFreeAddresses',
        'takeTaxFreeAddress',
        'clearUsedTaxFreeAddresses',
    ]) {
        expect(
            Reflect.getMetadata('__permissions__', Reflect.get(TaxFreeAddressAdminResolver.prototype, name)),
        ).toEqual([Permission.SuperAdmin]);
    }
});
