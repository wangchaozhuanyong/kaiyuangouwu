import gql from 'graphql-tag';

export const addressSchema = gql`
    type TaxFreeAddress {
        id: ID!
        country: String!
        line1: String!
        city: String!
        state: String!
        postalCode: String!
        status: String!
        createdAt: DateTime!
        usedAt: DateTime
    }
    type TaxFreeAddressStatus {
        serverNow: DateTime!
        nextAllowedAt: DateTime
    }
    type TaxFreeAddressClaim {
        requestId: String!
        address: TaxFreeAddress!
        serverNow: DateTime!
        nextAllowedAt: DateTime
    }
`;
export const adminSchema = gql`
    ${addressSchema}
    input TaxFreeAddressListInput {
        status: String
        keyword: String
        skip: Int
        take: Int
    }
    type TaxFreeAddressList {
        items: [TaxFreeAddress!]!
        totalItems: Int!
        unused: Int!
        used: Int!
        retained: Int!
        generated: Int!
        revision: Int!
        capacity: Int!
        limit: Int!
    }
    type TaxFreeAddressCount {
        count: Int!
    }
    extend type Query {
        taxFreeAddresses(input: TaxFreeAddressListInput): TaxFreeAddressList!
    }
    extend type Mutation {
        generateTaxFreeAddresses(count: Int!): TaxFreeAddressCount!
        takeTaxFreeAddress(id: ID!, requestId: String!): TaxFreeAddressClaim!
        clearUsedTaxFreeAddresses(expectedRevision: Int!): TaxFreeAddressCount!
    }
`;
