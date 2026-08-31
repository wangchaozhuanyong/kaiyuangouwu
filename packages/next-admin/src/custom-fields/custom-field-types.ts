export interface LocalizedValue {
    languageCode: string;
    value: string;
}

export interface CustomFieldOption {
    label?: LocalizedValue[] | null;
    value: string;
}

export interface StructFieldDefinition {
    __typename?: string;
    name: string;
    type: string;
    list?: boolean | null;
    label?: LocalizedValue[] | null;
    description?: LocalizedValue[] | null;
    ui?: Record<string, unknown> | null;
    pattern?: string | null;
    options?: CustomFieldOption[] | null;
    intMin?: number | null;
    intMax?: number | null;
    intStep?: number | null;
    floatMin?: number | null;
    floatMax?: number | null;
    floatStep?: number | null;
    datetimeMin?: string | null;
    datetimeMax?: string | null;
    datetimeStep?: number | null;
}

export interface CustomFieldDefinition extends StructFieldDefinition {
    list: boolean;
    readonly?: boolean | null;
    internal?: boolean | null;
    nullable?: boolean | null;
    requiresPermission?: string[] | null;
    deprecated?: boolean | null;
    deprecationReason?: string | null;
    entity?: string | null;
    scalarFields?: string[] | null;
    fields?: StructFieldDefinition[] | null;
}

export interface EntityCustomFieldsDefinition {
    entityName: string;
    customFields: CustomFieldDefinition[];
}

export interface CustomFieldServerConfigData {
    globalSettings: {
        availableLanguages: string[];
        serverConfig: {
            entityCustomFields: EntityCustomFieldsDefinition[];
        };
    };
}

export type CustomFieldValueMap = Record<string, unknown>;
