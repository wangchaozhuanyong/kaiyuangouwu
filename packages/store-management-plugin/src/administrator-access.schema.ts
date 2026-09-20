import { gql } from 'graphql-tag';

export const administratorAccessSchema = gql`
    enum AdministratorAccessScope {
        PLATFORM
        STORE
    }

    enum AdministratorAccessAuthority {
        OWNER
        ADMIN
        MANAGER
        STAFF
    }

    enum AdministratorAccessStatus {
        ACTIVE
        SUSPENDED
    }

    enum PermissionPolicyScope {
        OWNER_ONLY
        PLATFORM
        STORE
    }

    enum StoreGovernanceChangeType {
        LEGAL_IDENTITY
        PAYOUT_ACCOUNT
        PAYMENT_CONFIGURATION
        USDT_WALLET
    }

    enum StoreGovernanceChangeStatus {
        PENDING
        APPROVED
        REJECTED
        CANCELLED
    }

    type AdministratorAccessProfile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        administrator: Administrator!
        scope: AdministratorAccessScope!
        authority: AdministratorAccessAuthority!
        status: AdministratorAccessStatus!
        channel: Channel
        mustChangePassword: Boolean!
    }

    type PermissionPolicyItem {
        code: String!
        name: String!
        description: String!
        group: String!
        scope: PermissionPolicyScope!
        minimumAuthority: AdministratorAccessAuthority!
        sensitive: Boolean!
        delegable: Boolean!
        dependencies: [String!]!
    }

    type PermissionRoleTemplate {
        code: String!
        name: String!
        description: String!
        permissions: [String!]!
    }

    type PermissionPolicyCatalog {
        permissions: [PermissionPolicyItem!]!
        templates: [PermissionRoleTemplate!]!
    }

    type StoreGovernanceChangeRequest implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channel: Channel!
        requestType: StoreGovernanceChangeType!
        version: Int!
        status: StoreGovernanceChangeStatus!
        maskedSummary: JSON!
        reviewPayload: JSON
        reviewReason: String
        submittedAt: DateTime!
        reviewedAt: DateTime
    }

    type AdministratorPermissionAudit implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        actorAdministratorId: ID
        targetAdministratorId: ID
        targetRoleId: ID
        channelId: ID
        action: String!
        result: String!
        beforeSummary: JSON
        afterSummary: JSON
        failureReason: String
    }

    input CreateManagedAdministratorInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
        password: String!
        roleIds: [ID!]!
        scope: AdministratorAccessScope!
        authority: AdministratorAccessAuthority!
        channelId: ID
    }

    input UpdateManagedAdministratorInput {
        id: ID!
        firstName: String
        lastName: String
        emailAddress: String
        password: String
        roleIds: [ID!]
        authority: AdministratorAccessAuthority
    }

    input CreateManagedRoleInput {
        code: String!
        description: String!
        permissions: [Permission!]
        templateCode: String
        scope: AdministratorAccessScope!
        channelId: ID
    }

    input UpdateManagedRoleInput {
        id: ID!
        code: String!
        description: String!
        permissions: [Permission!]
        templateCode: String
        scope: AdministratorAccessScope!
        channelId: ID
    }

    input SubmitStoreGovernanceChangeInput {
        requestType: StoreGovernanceChangeType!
        payload: JSON!
    }

    input ReviewStoreGovernanceChangeInput {
        id: ID!
        decision: StoreGovernanceChangeStatus!
        reason: String
        currentPassword: String!
    }

    extend type Query {
        myAdministratorAccess: AdministratorAccessProfile!
        manageableAdministrators: [AdministratorAccessProfile!]!
        manageableRoles: [Role!]!
        manageableChannels: [Channel!]!
        permissionPolicyCatalog: PermissionPolicyCatalog!
        myStoreGovernanceChanges: [StoreGovernanceChangeRequest!]!
        storeGovernanceChanges(channelId: ID): [StoreGovernanceChangeRequest!]!
        administratorPermissionAudits: [AdministratorPermissionAudit!]!
    }

    extend type Mutation {
        createManagedAdministrator(input: CreateManagedAdministratorInput!): AdministratorAccessProfile!
        updateManagedAdministrator(input: UpdateManagedAdministratorInput!): AdministratorAccessProfile!
        suspendManagedAdministrator(administratorId: ID!): AdministratorAccessProfile!
        createManagedRole(input: CreateManagedRoleInput!): Role!
        updateManagedRole(input: UpdateManagedRoleInput!): Role!
        transferPlatformOwnership(
            targetAdministratorId: ID!
            currentPassword: String!
        ): AdministratorAccessProfile!
        transferStoreAdministration(
            channelId: ID!
            targetAdministratorId: ID!
            currentPassword: String!
        ): AdministratorAccessProfile!
        submitStoreGovernanceChange(input: SubmitStoreGovernanceChangeInput!): StoreGovernanceChangeRequest!
        reviewStoreGovernanceChange(input: ReviewStoreGovernanceChangeInput!): StoreGovernanceChangeRequest!
    }
`;
