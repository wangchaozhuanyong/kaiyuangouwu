import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    type DashboardTwoFactorAccount implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        projectName: String!
        secret: String!
        lastUsedAt: DateTime
    }

    input CreateDashboardTwoFactorAccountInput {
        projectName: String!
        secret: String!
    }

    input UpdateDashboardTwoFactorAccountInput {
        id: ID!
        projectName: String!
        secret: String!
    }

    input ImportDashboardTwoFactorAccountInput {
        projectName: String!
        secret: String!
    }

    extend type Query {
        dashboardTwoFactorAccounts: [DashboardTwoFactorAccount!]!
    }

    extend type Mutation {
        createDashboardTwoFactorAccount(
            input: CreateDashboardTwoFactorAccountInput!
        ): DashboardTwoFactorAccount!
        updateDashboardTwoFactorAccount(
            input: UpdateDashboardTwoFactorAccountInput!
        ): DashboardTwoFactorAccount!
        importDashboardTwoFactorAccounts(
            inputs: [ImportDashboardTwoFactorAccountInput!]!
        ): [DashboardTwoFactorAccount!]!
        deleteDashboardTwoFactorAccount(id: ID!): Boolean!
        clearDashboardTwoFactorAccounts: Boolean!
        touchDashboardTwoFactorAccount(id: ID!): DashboardTwoFactorAccount!
    }
`;
