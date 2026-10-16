import { gql } from 'graphql-tag';

export const shopSchema = gql`
    type GptRechargePublicConfig {
        enabled: Boolean!
        maintenance: Boolean!
    }
    type GptRechargeTask {
        id: ID!
        credential: String!
        plan: String!
        status: String!
        updatedAt: DateTime!
    }
    type GptRechargeCode {
        plan: String!
        status: String!
        task: GptRechargeTask
    }
    extend type Query {
        gptRechargeConfig: GptRechargePublicConfig!
        gptRechargeTask(id: ID!, credential: String!): GptRechargeTask!
    }
    extend type Mutation {
        verifyGptRechargeCode(code: String!): GptRechargeCode!
        queryGptRechargeCode(code: String!): GptRechargeCode!
        submitGptRecharge(code: String!, session: String!): GptRechargeTask!
    }
`;
export const adminSchema = gql`
    type GptRechargeAdminConfig {
        enabled: Boolean!
        upstreamOrigin: String!
        credentialConfigured: Boolean!
        revision: Int!
    }
    input GptRechargeConfigInput {
        enabled: Boolean!
        upstreamOrigin: String!
        serviceKey: String
        expectedRevision: Int!
    }
    extend type Query {
        gptRechargeAdminConfig: GptRechargeAdminConfig!
    }
    extend type Mutation {
        updateGptRechargeConfig(input: GptRechargeConfigInput!): GptRechargeAdminConfig!
    }
`;
