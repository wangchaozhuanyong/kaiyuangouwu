import { gql } from 'graphql-tag';

export const adminPromotionManagementSchema = gql`
    type AdminPromotionStore {
        id: ID!
        code: String!
        nameZh: String
        nameEn: String
    }

    type AdminPromotionManagementItem {
        promotion: Promotion!
        stores: [AdminPromotionStore!]!
        shared: Boolean!
        ownershipKnown: Boolean!
        archivedAt: DateTime
        claimStartsAt: DateTime
        claimEndsAt: DateTime
    }

    type AdminPromotionManagementList {
        items: [AdminPromotionManagementItem!]!
        totalItems: Int!
        stores: [AdminPromotionStore!]!
    }

    extend type Query {
        adminPromotionManagement(
            options: PromotionListOptions
            storeChannelId: ID
        ): AdminPromotionManagementList!
    }
`;
