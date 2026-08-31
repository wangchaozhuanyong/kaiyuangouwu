import { describe, expect, it } from 'vitest';
import type { EntityCustomFieldsDefinition } from './custom-field-types';

import { getCustomFieldDefinitions } from './custom-fields-context';

describe('custom field definitions context', () => {
    it('reuses one empty definition list when the entity is not configured', () => {
        const entities: EntityCustomFieldsDefinition[] = [];

        expect(getCustomFieldDefinitions(entities, 'Product')).toBe(
            getCustomFieldDefinitions(entities, 'Product'),
        );
    });

    it('returns the configured definition list unchanged', () => {
        const customFields = [{ name: 'priority', type: 'int', list: false }] as const;
        const entities = [
            {
                entityName: 'Product',
                customFields: [...customFields],
            },
        ] satisfies EntityCustomFieldsDefinition[];

        expect(getCustomFieldDefinitions(entities, 'Product')).toBe(entities[0].customFields);
    });
});
