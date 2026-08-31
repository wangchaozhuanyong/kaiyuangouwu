import { gql } from 'graphql-tag';

const accountFields = gql`
    fragment DashboardTwoFactorAccountFields on DashboardTwoFactorAccount {
        id
        createdAt
        updatedAt
        projectName
        secret
        lastUsedAt
    }
`;

export const dashboardTwoFactorAccountsQuery = gql`
    query DashboardTwoFactorAccounts {
        dashboardTwoFactorAccounts {
            ...DashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const createDashboardTwoFactorAccountMutation = gql`
    mutation CreateDashboardTwoFactorAccount($input: CreateDashboardTwoFactorAccountInput!) {
        createDashboardTwoFactorAccount(input: $input) {
            ...DashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const updateDashboardTwoFactorAccountMutation = gql`
    mutation UpdateDashboardTwoFactorAccount($input: UpdateDashboardTwoFactorAccountInput!) {
        updateDashboardTwoFactorAccount(input: $input) {
            ...DashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const importDashboardTwoFactorAccountsMutation = gql`
    mutation ImportDashboardTwoFactorAccounts($inputs: [ImportDashboardTwoFactorAccountInput!]!) {
        importDashboardTwoFactorAccounts(inputs: $inputs) {
            ...DashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const deleteDashboardTwoFactorAccountMutation = gql`
    mutation DeleteDashboardTwoFactorAccount($id: ID!) {
        deleteDashboardTwoFactorAccount(id: $id)
    }
`;

export const clearDashboardTwoFactorAccountsMutation = gql`
    mutation ClearDashboardTwoFactorAccounts {
        clearDashboardTwoFactorAccounts
    }
`;

export const touchDashboardTwoFactorAccountMutation = gql`
    mutation TouchDashboardTwoFactorAccount($id: ID!) {
        touchDashboardTwoFactorAccount(id: $id) {
            ...DashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;
