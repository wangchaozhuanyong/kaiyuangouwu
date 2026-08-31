import { Kind, type DocumentNode, type FieldNode, type SelectionNode, type SelectionSetNode } from 'graphql';
import type {
    CustomFieldDefinition,
    CustomFieldValueMap,
    LocalizedValue,
    StructFieldDefinition,
} from './custom-field-types';

export function localizedText(
    values: LocalizedValue[] | null | undefined,
    languageCode = 'zh_Hans',
    fallback = '',
) {
    return (
        values?.find(value => value.languageCode === languageCode)?.value ??
        values?.find(value => value.languageCode === 'en')?.value ??
        values?.[0]?.value ??
        fallback
    );
}

export function isDashboardVisibleCustomField(field: CustomFieldDefinition) {
    return field.ui?.dashboard !== false && !field.internal && !field.deprecated;
}

export function getCustomFieldInputName(field: Pick<CustomFieldDefinition, 'name' | 'type' | 'list'>) {
    if (field.type !== 'relation') return field.name;
    return `${field.name}${field.list ? 'Ids' : 'Id'}`;
}

function relationValue(value: unknown, list: boolean) {
    if (list) {
        return Array.isArray(value)
            ? value.map(item =>
                  typeof item === 'object' && item !== null && 'id' in item
                      ? scalarString(item.id)
                      : scalarString(item),
              )
            : [];
    }
    if (typeof value === 'object' && value !== null && 'id' in value) {
        return scalarString(value.id);
    }
    return value ?? null;
}

function scalarString(value: unknown) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : '';
}

export function customFieldValuesFromEntity(
    fields: readonly CustomFieldDefinition[],
    customFields: Record<string, unknown> | null | undefined,
    translations: ReadonlyArray<{
        languageCode: string;
        customFields?: Record<string, unknown> | null;
    }> = [],
): CustomFieldValueMap {
    return Object.fromEntries(
        fields.map(field => [
            field.name,
            field.type === 'localeString' || field.type === 'localeText'
                ? Object.fromEntries(
                      translations.map(translation => [
                          translation.languageCode,
                          translation.customFields?.[field.name] ?? null,
                      ]),
                  )
                : field.type === 'relation'
                  ? relationValue(customFields?.[field.name], field.list)
                  : (customFields?.[field.name] ?? (field.list ? [] : null)),
        ]),
    );
}

export function localizedCustomFieldInputFromValues(
    fields: readonly CustomFieldDefinition[],
    values: CustomFieldValueMap,
    languageCode: string,
    excludedFieldNames: readonly string[] = [],
) {
    const excluded = new Set(excludedFieldNames);
    const input: Record<string, unknown> = {};
    for (const field of fields) {
        if (
            excluded.has(field.name) ||
            field.readonly ||
            (field.type !== 'localeString' && field.type !== 'localeText')
        ) {
            continue;
        }
        const localized = values[field.name];
        if (!localized || typeof localized !== 'object' || Array.isArray(localized)) continue;
        if (!(languageCode in localized)) continue;
        input[field.name] = (localized as Record<string, unknown>)[languageCode];
    }
    return input;
}

export function customFieldInputFromValues(
    fields: readonly CustomFieldDefinition[],
    values: CustomFieldValueMap,
    excludedFieldNames: readonly string[] = [],
) {
    const excluded = new Set(excludedFieldNames);
    const input: Record<string, unknown> = {};
    for (const field of fields) {
        if (
            excluded.has(field.name) ||
            field.readonly ||
            field.type === 'localeString' ||
            field.type === 'localeText'
        ) {
            continue;
        }
        if (!(field.name in values)) continue;
        input[getCustomFieldInputName(field)] = values[field.name];
    }
    return input;
}

export function validateCustomFieldValues(
    fields: readonly CustomFieldDefinition[],
    values: CustomFieldValueMap,
    languageCode = 'zh_Hans',
) {
    const errors: Record<string, string> = {};
    for (const field of fields.filter(isDashboardVisibleCustomField)) {
        const value = values[field.name];
        const validationValue =
            field.type === 'localeString' || field.type === 'localeText'
                ? value && typeof value === 'object' && !Array.isArray(value)
                    ? (value as Record<string, unknown>)[languageCode]
                    : null
                : value;
        const label = localizedText(field.label, languageCode, field.name);
        if (!field.nullable && !field.readonly) {
            const empty =
                validationValue == null ||
                validationValue === '' ||
                (Array.isArray(validationValue) && validationValue.length === 0);
            if (empty) errors[field.name] = `${label}不能为空`;
        }
        if (typeof validationValue === 'string' && field.pattern) {
            try {
                if (validationValue && !new RegExp(field.pattern).test(validationValue)) {
                    errors[field.name] = `${label}格式不正确`;
                }
            } catch {
                errors[field.name] = `${label}的后端校验规则无效`;
            }
        }
    }
    return errors;
}

function selectionForField(field: CustomFieldDefinition | StructFieldDefinition): FieldNode {
    let selections: SelectionNode[] | undefined;
    if (field.type === 'relation') {
        selections = ((field as CustomFieldDefinition).scalarFields ?? ['id']).map(name => ({
            kind: Kind.FIELD,
            name: { kind: Kind.NAME, value: name },
        }));
    } else if (field.type === 'struct') {
        selections = ((field as CustomFieldDefinition).fields ?? []).map(selectionForField);
    }
    return {
        kind: Kind.FIELD,
        name: { kind: Kind.NAME, value: field.name },
        ...(selections?.length ? { selectionSet: { kind: Kind.SELECTION_SET, selections } } : {}),
    };
}

function mergeCustomFieldsSelection(selectionSet: SelectionSetNode, fields: CustomFieldDefinition[]) {
    if (fields.length === 0) return;
    const localizedFields = fields.filter(
        field => field.type === 'localeString' || field.type === 'localeText',
    );
    const regularFields = fields.filter(
        field => field.type !== 'localeString' && field.type !== 'localeText',
    );
    const existing = selectionSet.selections.find(
        selection => selection.kind === Kind.FIELD && selection.name.value === 'customFields',
    ) as FieldNode | undefined;
    const existingNames = new Set(
        existing?.selectionSet?.selections
            .filter((selection): selection is FieldNode => selection.kind === Kind.FIELD)
            .map(selection => selection.name.value) ?? [],
    );
    const dynamicSelections = regularFields
        .filter(field => !existingNames.has(field.name))
        .map(selectionForField);
    if (existing && dynamicSelections.length > 0) {
        (existing as { selectionSet?: SelectionSetNode }).selectionSet = {
            kind: Kind.SELECTION_SET,
            selections: [...(existing.selectionSet?.selections ?? []), ...dynamicSelections],
        };
    } else if (dynamicSelections.length > 0) {
        (selectionSet.selections as SelectionNode[]).push({
            kind: Kind.FIELD,
            name: { kind: Kind.NAME, value: 'customFields' },
            selectionSet: { kind: Kind.SELECTION_SET, selections: dynamicSelections },
        });
    }

    if (localizedFields.length > 0) {
        const translations = selectionSet.selections.find(
            selection => selection.kind === Kind.FIELD && selection.name.value === 'translations',
        ) as FieldNode | undefined;
        if (translations?.selectionSet) {
            mergeCustomFieldsSelection(
                translations.selectionSet,
                localizedFields.map(field => ({
                    ...field,
                    type: field.type === 'localeText' ? 'text' : 'string',
                })),
            );
        }
    }
}

export function addCustomFieldsToDocument<T extends DocumentNode>(
    document: T,
    entityType: string,
    fields: readonly CustomFieldDefinition[],
    rootFieldNames: readonly string[] = [],
): T {
    const visibleFields = fields.filter(isDashboardVisibleCustomField);
    if (visibleFields.length === 0) return document;
    const clone = structuredClone(document);
    const rootNames = new Set(rootFieldNames);

    for (const definition of clone.definitions) {
        if (
            definition.kind === Kind.FRAGMENT_DEFINITION &&
            definition.typeCondition.name.value === entityType
        ) {
            mergeCustomFieldsSelection(definition.selectionSet, visibleFields);
        }
        if (definition.kind === Kind.OPERATION_DEFINITION && rootNames.size > 0) {
            for (const selection of definition.selectionSet.selections) {
                if (
                    selection.kind === Kind.FIELD &&
                    rootNames.has(selection.name.value) &&
                    selection.selectionSet
                ) {
                    mergeCustomFieldsSelection(selection.selectionSet, visibleFields);
                }
            }
        }
    }
    return clone;
}
