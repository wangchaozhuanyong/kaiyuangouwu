import { gql } from 'graphql-tag';

export const adminCapabilitiesSchema = gql`
    enum AdminCapabilityState {
        READY
        NEEDS_CONFIGURATION
        DISABLED
        UNSUPPORTED
        FORBIDDEN
    }
    enum AdminCapabilityCommerceMode {
        DIGITAL_ONLY
        PHYSICAL_ONLY
        HYBRID
    }
    type AdminCapabilityStatus {
        id: String!
        state: AdminCapabilityState!
        canRead: Boolean!
        canWrite: Boolean!
        canConfigure: Boolean!
    }
    type AdminCapabilitySnapshot {
        channelId: ID!
        channelCode: String!
        scope: AdministratorAccessScope!
        commerceMode: AdminCapabilityCommerceMode
        capabilities: [AdminCapabilityStatus!]!
    }
    extend type Query {
        currentAdminCapabilities: AdminCapabilitySnapshot!
    }
`;
