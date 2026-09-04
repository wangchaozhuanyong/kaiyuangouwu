import { InMemoryCache, gql } from '@apollo/client';
import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldServerConfigData } from './custom-field-types';
import { CUSTOM_FIELD_POSSIBLE_TYPES, CUSTOM_FIELD_SERVER_CONFIG_QUERY } from './custom-fields.graphql';

import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    getCustomFieldInputName,
    isDashboardVisibleCustomField,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from './custom-field-utils';

const fields: CustomFieldDefinition[] = [
    { name: 'priority', type: 'int', list: false },
    {
        name: 'owner',
        type: 'relation',
        list: false,
        entity: 'Customer',
        scalarFields: ['id', 'emailAddress'],
    },
    {
        name: 'metadata',
        type: 'struct',
        list: false,
        fields: [{ name: 'source', type: 'string', list: false }],
    },
];

describe('next-admin dynamic custom fields', () => {
    it('adds primitive, relation and struct selections without replacing explicit fields', () => {
        const document = gql`
            query Order($id: ID!) {
                order(id: $id) {
                    id
                    customFields {
                        existing
                    }
                }
            }
        `;
        const transformed = print(addCustomFieldsToDocument(document, 'Order', fields, ['order']));
        expect(transformed).toContain('existing');
        expect(transformed).toContain('priority');
        expect(transformed).toContain('owner {');
        expect(transformed).toContain('emailAddress');
        expect(transformed).toContain('metadata {');
        expect(transformed).toContain('source');
    });

    it('maps relation fields to Vendure input names and skips readonly fields', () => {
        expect(getCustomFieldInputName(fields[1])).toBe('ownerId');
        expect(
            customFieldInputFromValues(
                [...fields, { name: 'locked', type: 'string', list: false, readonly: true }],
                { priority: 2, owner: 'c-1', metadata: { source: 'web' }, locked: 'no' },
            ),
        ).toEqual({ priority: 2, ownerId: 'c-1', metadata: { source: 'web' } });
    });

    it('hides internal, deprecated and dashboard-disabled fields', () => {
        expect(isDashboardVisibleCustomField({ name: 'x', type: 'string', list: false })).toBe(true);
        expect(
            isDashboardVisibleCustomField({
                name: 'x',
                type: 'string',
                list: false,
                ui: { dashboard: false },
            }),
        ).toBe(false);
        expect(
            isDashboardVisibleCustomField({ name: 'x', type: 'string', list: false, internal: true }),
        ).toBe(false);
        expect(
            isDashboardVisibleCustomField({
                name: undefined as unknown as string,
                type: 'string',
                list: false,
            }),
        ).toBe(false);
    });

    it('ignores incomplete cached field names and falls relation selections back to id', () => {
        const incompleteFields: CustomFieldDefinition[] = [
            {
                name: 'owner',
                type: 'relation',
                list: false,
                scalarFields: [undefined as unknown as string, ''],
            },
            {
                name: 'metadata',
                type: 'struct',
                list: false,
                fields: [
                    { name: undefined as unknown as string, type: 'string', list: false },
                    { name: 'source', type: 'string', list: false },
                ],
            },
        ];
        const transformed = print(
            addCustomFieldsToDocument(
                gql`
                    query Order($id: ID!) {
                        order(id: $id) {
                            id
                        }
                    }
                `,
                'Order',
                incompleteFields,
                ['order'],
            ),
        );

        expect(transformed).toMatch(/owner \{\s+id/u);
        expect(transformed).toMatch(/metadata \{\s+source/u);
        expect(transformed).not.toContain('undefined');
    });

    it('never reads or writes an invalid cached field name', () => {
        const malformedFields: CustomFieldDefinition[] = [
            { name: undefined as unknown as string, type: 'string', list: false },
            { name: 'priority', type: 'int', list: false },
            { name: '' as unknown as string, type: 'localeString', list: false },
        ];

        expect(customFieldValuesFromEntity(malformedFields, { priority: 3 })).toEqual({ priority: 3 });
        expect(customFieldInputFromValues(malformedFields, { undefined: null, priority: 3 })).toEqual({
            priority: 3,
        });
        expect(localizedCustomFieldInputFromValues(malformedFields, { '': { en: 'invalid' } }, 'en')).toEqual(
            {},
        );
    });

    it('preserves CustomField interface properties in the Apollo cache', () => {
        const cache = new InMemoryCache({ possibleTypes: CUSTOM_FIELD_POSSIBLE_TYPES });
        cache.writeQuery({
            query: CUSTOM_FIELD_SERVER_CONFIG_QUERY,
            data: {
                globalSettings: {
                    __typename: 'GlobalSettings',
                    availableLanguages: ['zh_Hans', 'en'],
                    serverConfig: {
                        __typename: 'ServerConfig',
                        entityCustomFields: [
                            {
                                __typename: 'EntityCustomFields',
                                entityName: 'ProductVariant',
                                customFields: [
                                    {
                                        __typename: 'StringCustomFieldConfig',
                                        name: 'merchantNote',
                                        type: 'string',
                                        list: false,
                                        label: [],
                                        description: [],
                                        readonly: false,
                                        internal: false,
                                        nullable: true,
                                        requiresPermission: [],
                                        deprecated: false,
                                        deprecationReason: null,
                                        ui: {},
                                        pattern: null,
                                        options: [],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        });

        const result = cache.readQuery<CustomFieldServerConfigData>({
            query: CUSTOM_FIELD_SERVER_CONFIG_QUERY,
        });
        const field = result?.globalSettings.serverConfig.entityCustomFields[0].customFields[0];
        expect(field).toMatchObject({ name: 'merchantNote', type: 'string', list: false });
    });

    it('reads and writes localized values through translation custom fields', () => {
        const localizedFields: CustomFieldDefinition[] = [
            { name: 'tagline', type: 'localeString', list: false, nullable: false },
        ];
        const values = customFieldValuesFromEntity(localizedFields, null, [
            { languageCode: 'zh_Hans', customFields: { tagline: '中文标语' } },
            { languageCode: 'en', customFields: { tagline: 'English tagline' } },
        ]);

        expect(values).toEqual({
            tagline: { zh_Hans: '中文标语', en: 'English tagline' },
        });
        expect(localizedCustomFieldInputFromValues(localizedFields, values, 'en')).toEqual({
            tagline: 'English tagline',
        });
        expect(validateCustomFieldValues(localizedFields, values, 'zh_Hans')).toEqual({});
        expect(
            validateCustomFieldValues(localizedFields, { tagline: { en: 'Only English' } }, 'zh_Hans'),
        ).toEqual({ tagline: 'tagline不能为空' });

        const localizedDocument = print(
            addCustomFieldsToDocument(
                gql`
                    query Product($id: ID!) {
                        product(id: $id) {
                            id
                            translations {
                                languageCode
                            }
                        }
                    }
                `,
                'Product',
                localizedFields,
                ['product'],
            ),
        );
        expect(localizedDocument).toContain('translations {');
        expect(localizedDocument).toContain('customFields {');
        expect(localizedDocument).toContain('tagline');
    });
});
