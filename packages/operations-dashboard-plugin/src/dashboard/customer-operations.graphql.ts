import { gql } from 'graphql-tag';

export interface CustomerOperationsResult {
    customerOperationsProfile: {
        id: string;
        segment: string;
        churnRisk: string;
        recencyScore: number;
        frequencyScore: number;
        monetaryScore: number;
        recencyDays: number | null;
        orderCount: number;
        currencyMetrics: Array<{
            currencyCode: string;
            orderCount: number;
            grossRevenue: number;
            refundTotal: number;
            netLifetimeValue: number;
        }>;
        serviceInteractionCount: number;
        afterSalesCount: number;
        openAfterSalesCount: number;
        nextFollowUpAt: string | null;
        doNotContact: boolean;
        reasons: string[];
        lastEvaluatedAt: string;
    };
    customerFollowUps: {
        totalItems: number;
        items: Array<{
            id: string;
            source: string;
            priority: string;
            title: string;
            note: string;
            dueAt: string;
            overdue: boolean;
            events: Array<{
                id: string;
                createdAt: string;
                actorLabel: string;
                note: string;
            }>;
        }>;
    };
}

export const customerOperationsQuery = gql`
    query DashboardCustomerOperations($customerId: ID!) {
        customerOperationsProfile(customerId: $customerId) {
            id
            segment
            churnRisk
            recencyScore
            frequencyScore
            monetaryScore
            recencyDays
            orderCount
            currencyMetrics {
                currencyCode
                orderCount
                grossRevenue
                refundTotal
                netLifetimeValue
            }
            serviceInteractionCount
            afterSalesCount
            openAfterSalesCount
            nextFollowUpAt
            doNotContact
            reasons
            lastEvaluatedAt
        }
        customerFollowUps(options: { customerId: $customerId, status: OPEN, take: 50 }) {
            totalItems
            items {
                id
                source
                priority
                title
                note
                dueAt
                overdue
                events {
                    id
                    createdAt
                    actorLabel
                    note
                }
            }
        }
    }
`;

export const refreshCustomerOperationsMutation = gql`
    mutation DashboardRefreshCustomerOperations($customerId: ID!) {
        refreshCustomerOperationsProfile(customerId: $customerId) {
            id
            lastEvaluatedAt
        }
    }
`;

export const createCustomerFollowUpMutation = gql`
    mutation DashboardCreateCustomerFollowUp($input: CreateCustomerFollowUpInput!) {
        createCustomerFollowUp(input: $input) {
            id
            status
        }
    }
`;

export const updateCustomerFollowUpMutation = gql`
    mutation DashboardUpdateCustomerFollowUp($input: UpdateCustomerFollowUpInput!) {
        updateCustomerFollowUp(input: $input) {
            id
            status
            outcomeCode
        }
    }
`;
