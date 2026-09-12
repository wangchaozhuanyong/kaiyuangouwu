import { MockedProvider } from '@apollo/client/testing/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomFieldsContext } from '../../custom-fields/custom-fields-context';
import { ProductVariantCustomFieldsBlock } from './CatalogOperationsBlocks';
import { calculateDefaultExpiryDate } from './catalog-expiry';

describe('calculateDefaultExpiryDate', () => {
    it('calculates the real lot expiry date from its production date and default shelf life', () => {
        expect(calculateDefaultExpiryDate('2028-02-28', 2)).toBe('2028-03-01');
    });

    it('does not invent an expiry date without a production date or valid shelf life', () => {
        expect(calculateDefaultExpiryDate('', 30)).toBe('');
        expect(calculateDefaultExpiryDate('2026-09-10', null)).toBe('');
        expect(calculateDefaultExpiryDate('2026-09-10', -1)).toBe('');
        expect(calculateDefaultExpiryDate('2026-02-31', 30)).toBe('');
    });
});

describe('ProductVariantCustomFieldsBlock', () => {
    it('does not render the generic editor when every SKU field is hidden or malformed', () => {
        const html = renderToStaticMarkup(
            <MockedProvider>
                <CustomFieldsContext.Provider
                    value={{
                        availableLanguages: ['zh_Hans', 'en'],
                        entities: [
                            {
                                entityName: 'ProductVariant',
                                customFields: [
                                    {
                                        name: 'digitalDeliveryMode',
                                        type: 'string',
                                        list: false,
                                        ui: { dashboard: false },
                                    },
                                    {
                                        name: undefined as unknown as string,
                                        type: 'string',
                                        list: false,
                                    },
                                    {
                                        name: 'restrictedField',
                                        type: 'string',
                                        list: false,
                                        requiresPermission: ['SuperAdmin'],
                                    },
                                ],
                            },
                        ],
                    }}
                >
                    <ProductVariantCustomFieldsBlock context={{ entity: { id: '11' } } as never} />
                </CustomFieldsContext.Provider>
            </MockedProvider>,
        );

        expect(html).toBe('');
    });
});
