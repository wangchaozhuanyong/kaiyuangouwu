import { gql } from '@apollo/client';

export const CUSTOM_FIELD_SERVER_CONFIG_QUERY = gql`
    query NextAdminCustomFieldServerConfig {
        globalSettings {
            availableLanguages
            serverConfig {
                entityCustomFields {
                    entityName
                    customFields {
                        ... on CustomField {
                            name
                            type
                            list
                            label {
                                languageCode
                                value
                            }
                            description {
                                languageCode
                                value
                            }
                            readonly
                            internal
                            nullable
                            requiresPermission
                            deprecated
                            deprecationReason
                            ui
                        }
                        ... on StringCustomFieldConfig {
                            pattern
                            options {
                                value
                                label {
                                    languageCode
                                    value
                                }
                            }
                        }
                        ... on LocaleStringCustomFieldConfig {
                            pattern
                        }
                        ... on IntCustomFieldConfig {
                            intMin: min
                            intMax: max
                            intStep: step
                        }
                        ... on FloatCustomFieldConfig {
                            floatMin: min
                            floatMax: max
                            floatStep: step
                        }
                        ... on DateTimeCustomFieldConfig {
                            datetimeMin: min
                            datetimeMax: max
                            datetimeStep: step
                        }
                        ... on RelationCustomFieldConfig {
                            entity
                            scalarFields
                        }
                        ... on StructCustomFieldConfig {
                            fields {
                                ... on StructField {
                                    name
                                    type
                                    list
                                    label {
                                        languageCode
                                        value
                                    }
                                    description {
                                        languageCode
                                        value
                                    }
                                    ui
                                }
                                ... on StringStructFieldConfig {
                                    pattern
                                    options {
                                        value
                                        label {
                                            languageCode
                                            value
                                        }
                                    }
                                }
                                ... on IntStructFieldConfig {
                                    intMin: min
                                    intMax: max
                                    intStep: step
                                }
                                ... on FloatStructFieldConfig {
                                    floatMin: min
                                    floatMax: max
                                    floatStep: step
                                }
                                ... on DateTimeStructFieldConfig {
                                    datetimeMin: min
                                    datetimeMax: max
                                    datetimeStep: step
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;
