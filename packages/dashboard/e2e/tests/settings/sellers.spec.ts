import { test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

test.describe('Sellers', () => {
    test.describe.configure({ mode: 'serial' });

    createCrudTestSuite({
        entityName: 'seller',
        entityNamePlural: 'sellers',
        listPath: '/sellers',
        listTitle: 'Merchants',
        newButtonLabel: 'New Merchant',
        newPageTitle: 'New merchant',
        createFields: [{ label: 'Name', value: 'E2E Test Seller' }],
        updateFields: [{ label: 'Name', value: 'E2E Test Seller Updated' }],
        hasBulkDelete: true,
    });
});
