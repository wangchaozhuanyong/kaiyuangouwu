import { Kind, TypeNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions } from './api-extensions';

describe('store management API extensions', () => {
    it('uses Node items for every PaginatedList implementation', () => {
        const objectTypes = adminApiExtensions.definitions.filter(
            definition => definition.kind === Kind.OBJECT_TYPE_DEFINITION,
        );
        const nodeTypes = new Set(
            objectTypes
                .filter(definition => definition.interfaces?.some(item => item.name.value === 'Node'))
                .map(definition => definition.name.value),
        );
        const paginatedLists = objectTypes.filter(definition =>
            definition.interfaces?.some(item => item.name.value === 'PaginatedList'),
        );

        for (const list of paginatedLists) {
            const items = list.fields?.find(field => field.name.value === 'items');
            const itemType = items && namedType(items.type);
            expect(itemType, `${list.name.value}.items must resolve to a Node type`).toBeTruthy();
            expect(nodeTypes, `${list.name.value}.items must implement Node`).toContain(itemType);
        }
    });
});

function namedType(type: TypeNode): string {
    if (type.kind === Kind.NAMED_TYPE) return type.name.value;
    return namedType(type.type);
}
