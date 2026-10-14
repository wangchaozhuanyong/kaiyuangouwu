import { gql } from 'graphql-tag';

export const dataSubjectVerificationShopSchema = gql`
    enum DataSubjectAction {
        EXPORT
        ACCOUNT_CLOSURE
    }
    type DataSubjectVerificationChallenge {
        mode: String!
        challengeId: String
        nonce: String
        clientId: String
        expiresAt: DateTime
    }
    input DataSubjectVerificationInput {
        challengeId: String!
        nonce: String!
        credential: String!
    }

    extend type Mutation {
        exportMyPersonalData(
            password: String!
            verification: DataSubjectVerificationInput
        ): DataSubjectExportPayload!
        requestMyAccountClosure(
            password: String!
            verification: DataSubjectVerificationInput
        ): DataSubjectRequest!
        requestMyDataSubjectVerification(action: DataSubjectAction!): DataSubjectVerificationChallenge!
    }
`;
