import { gql } from '@apollo/client';

export interface DashboardTwoFactorAccount {
    id: string;
    createdAt: string;
    updatedAt: string;
    projectName: string;
    secret: string;
    lastUsedAt: string | null;
}

export interface DashboardTwoFactorAccountsResult {
    me: { id: string } | null;
    dashboardTwoFactorAccounts: DashboardTwoFactorAccount[];
}

const accountFields = gql`
    fragment NextAdminDashboardTwoFactorAccountFields on DashboardTwoFactorAccount {
        id
        createdAt
        updatedAt
        projectName
        secret
        lastUsedAt
    }
`;

export const DASHBOARD_TWO_FACTOR_ACCOUNTS_QUERY = gql`
    query NextAdminDashboardTwoFactorAccounts {
        me {
            id
        }
        dashboardTwoFactorAccounts {
            ...NextAdminDashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const CREATE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION = gql`
    mutation NextAdminCreateDashboardTwoFactorAccount($input: CreateDashboardTwoFactorAccountInput!) {
        createDashboardTwoFactorAccount(input: $input) {
            ...NextAdminDashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const UPDATE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION = gql`
    mutation NextAdminUpdateDashboardTwoFactorAccount($input: UpdateDashboardTwoFactorAccountInput!) {
        updateDashboardTwoFactorAccount(input: $input) {
            ...NextAdminDashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const IMPORT_DASHBOARD_TWO_FACTOR_ACCOUNTS_MUTATION = gql`
    mutation NextAdminImportDashboardTwoFactorAccounts($inputs: [ImportDashboardTwoFactorAccountInput!]!) {
        importDashboardTwoFactorAccounts(inputs: $inputs) {
            ...NextAdminDashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;

export const DELETE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION = gql`
    mutation NextAdminDeleteDashboardTwoFactorAccount($id: ID!) {
        deleteDashboardTwoFactorAccount(id: $id)
    }
`;

export const CLEAR_DASHBOARD_TWO_FACTOR_ACCOUNTS_MUTATION = gql`
    mutation NextAdminClearDashboardTwoFactorAccounts {
        clearDashboardTwoFactorAccounts
    }
`;

export const TOUCH_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION = gql`
    mutation NextAdminTouchDashboardTwoFactorAccount($id: ID!) {
        touchDashboardTwoFactorAccount(id: $id) {
            ...NextAdminDashboardTwoFactorAccountFields
        }
    }
    ${accountFields}
`;
