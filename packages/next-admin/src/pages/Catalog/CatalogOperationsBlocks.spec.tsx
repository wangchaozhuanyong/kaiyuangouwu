import { MockedProvider } from '@apollo/client/testing/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomFieldsContext } from '../../custom-fields/custom-fields-context';
import { ProductVariantCustomFieldsBlock } from './CatalogOperationsBlocks';

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
