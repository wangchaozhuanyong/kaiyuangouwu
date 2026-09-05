import { gql } from 'graphql-tag';

export const adminApiExtensions = gql`
    enum AdminAccountLoginStatus {
        SUCCESS
        REQUIRES_2FA
        ERROR
    }
    type AdminAccountLoginResult {
        status: AdminAccountLoginStatus!
        message: String
        challengeToken: String
        expiresAt: DateTime
        activeChannelToken: String
    }
    type AdminTwoFactorStatus {
        available: Boolean!
        enabled: Boolean!
        enabledAt: DateTime
        recoveryCodesRemaining: Int!
    }
    type AdminTwoFactorSetup {
        secret: String!
        otpauthUri: String!
        expiresAt: DateTime!
    }
    type AdminTwoFactorRecoveryCodes {
        success: Boolean!
        recoveryCodes: [String!]!
    }
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
        adminTwoFactorStatus: AdminTwoFactorStatus!
        dashboardTwoFactorAccounts: [DashboardTwoFactorAccount!]!
    }

    extend type Mutation {
        adminBeginLogin(username: String!, password: String!, rememberMe: Boolean!): AdminAccountLoginResult!
        adminCompleteTwoFactorLogin(challengeToken: String!, code: String!): AdminAccountLoginResult!
        adminBeginTwoFactorSetup(password: String!, code: String): AdminTwoFactorSetup!
        adminConfirmTwoFactorSetup(password: String!, code: String!): AdminTwoFactorRecoveryCodes!
        adminDisableTwoFactor(password: String!, code: String!): Success!
        adminRegenerateTwoFactorRecoveryCodes(password: String!, code: String!): AdminTwoFactorRecoveryCodes!
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
