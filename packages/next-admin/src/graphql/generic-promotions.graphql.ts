import { gql } from '@apollo/client';

const OPERATION_DEFINITION_FIELDS = gql`
    fragment NextAdminOperationDefinitionFields on ConfigurableOperationDefinition {
        code
        description
        args {
            name
            type
            list
            required
            defaultValue
            label
            description
            ui
        }
    }
`;

export const GENERIC_PROMOTIONS_QUERY = gql`
    ${OPERATION_DEFINITION_FIELDS}
    query NextAdminGenericPromotions($options: PromotionListOptions) {
        activeChannel {
            id
            defaultLanguageCode
        }
        promotions(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                enabled
                description
                couponCode
                startsAt
                endsAt
                usageLimit
                perCustomerUsageLimit
            }
            totalItems
        }
        promotionConditions {
            ...NextAdminOperationDefinitionFields
        }
        promotionActions {
            ...NextAdminOperationDefinitionFields
        }
    }
`;

export const GENERIC_PROMOTION_DETAIL_QUERY = gql`
    query NextAdminGenericPromotionDetail($id: ID!) {
        promotion(id: $id) {
            id
            createdAt
            updatedAt
            name
            description
            enabled
            couponCode
            perCustomerUsageLimit
            usageLimit
            startsAt
            endsAt
            conditions {
                code
                args {
                    name
                    value
                }
            }
            actions {
                code
                args {
                    name
                    value
                }
            }
            translations {
                id
                languageCode
                name
                description
            }
        }
    }
`;

export const CREATE_GENERIC_PROMOTION_MUTATION = gql`
    mutation NextAdminCreateGenericPromotion($input: CreatePromotionInput!) {
        createPromotion(input: $input) {
            __typename
            ... on Promotion {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const UPDATE_GENERIC_PROMOTION_MUTATION = gql`
    mutation NextAdminUpdateGenericPromotion($input: UpdatePromotionInput!) {
        updatePromotion(input: $input) {
            __typename
            ... on Promotion {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const DELETE_GENERIC_PROMOTION_MUTATION = gql`
    mutation NextAdminDeleteGenericPromotion($id: ID!) {
        deletePromotion(id: $id) {
            result
            message
        }
    }
`;

export interface OperationArgDefinition {
    name: string;
    type: string;
    list: boolean;
    required: boolean;
    defaultValue: unknown;
    label: string | null;
    description: string | null;
    ui: unknown;
}
export interface OperationDefinition {
    code: string;
    description: string;
    args: OperationArgDefinition[];
}
export interface OperationValue {
    code: string;
    arguments: Array<{ name: string; value: string }>;
}
export interface GenericPromotionListRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    enabled: boolean;
    description: string;
    couponCode: string | null;
    startsAt: string | null;
    endsAt: string | null;
    usageLimit: number | null;
    perCustomerUsageLimit: number | null;
}
export interface GenericPromotionsData {
    activeChannel: { id: string; defaultLanguageCode: string };
    promotions: { items: GenericPromotionListRecord[]; totalItems: number };
    promotionConditions: OperationDefinition[];
    promotionActions: OperationDefinition[];
}
export interface GenericPromotionDetailData {
    promotion:
        | (GenericPromotionListRecord & {
              conditions: Array<{ code: string; args: Array<{ name: string; value: string }> }>;
              actions: Array<{ code: string; args: Array<{ name: string; value: string }> }>;
              translations: Array<{ id: string; languageCode: string; name: string; description: string }>;
          })
        | null;
}
