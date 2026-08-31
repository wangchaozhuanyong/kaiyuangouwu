import { createContext, useContext } from 'react';
import type { CustomFieldDefinition, EntityCustomFieldsDefinition } from './custom-field-types';

interface CustomFieldsContextValue {
    availableLanguages: string[];
    entities: EntityCustomFieldsDefinition[];
}

const EMPTY_CUSTOM_FIELD_DEFINITIONS: CustomFieldDefinition[] = [];

export const CustomFieldsContext = createContext<CustomFieldsContextValue>({
    availableLanguages: [],
    entities: [],
});

export function getCustomFieldDefinitions(
    entities: readonly EntityCustomFieldsDefinition[],
    entityName: string,
): CustomFieldDefinition[] {
    return (
        entities.find(entity => entity.entityName === entityName)?.customFields ??
        EMPTY_CUSTOM_FIELD_DEFINITIONS
    );
}

export function useCustomFieldDefinitions(entityName: string): CustomFieldDefinition[] {
    const context = useContext(CustomFieldsContext);
    return getCustomFieldDefinitions(context.entities, entityName);
}

export function useCustomFieldLanguages() {
    return useContext(CustomFieldsContext).availableLanguages;
}
