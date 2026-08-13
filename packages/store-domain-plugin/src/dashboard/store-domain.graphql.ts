import { gql } from 'graphql-tag';

export const storeDomainsQuery = gql`
    query StoreDomains($channelId: ID!) {
        storeDomains(channelId: $channelId) {
            id
            domain
            isPrimary
            status
            verificationRecordName
            verificationRecordValue
            verifiedAt
            lastVerificationError
        }
        storeDomainConfiguration {
            cnameTarget
            routingMode
        }
    }
`;

export const createStoreDomainMutation = gql`
    mutation CreateStoreDomain($input: CreateStoreDomainInput!) {
        createStoreDomain(input: $input) {
            id
        }
    }
`;

export const verifyStoreDomainMutation = gql`
    mutation VerifyStoreDomain($id: ID!) {
        verifyStoreDomain(id: $id) {
            success
            message
        }
    }
`;

export const setPrimaryStoreDomainMutation = gql`
    mutation SetPrimaryStoreDomain($id: ID!) {
        setPrimaryStoreDomain(id: $id) {
            id
        }
    }
`;

export const deleteStoreDomainMutation = gql`
    mutation DeleteStoreDomain($id: ID!) {
        deleteStoreDomain(id: $id) {
            result
            message
        }
    }
`;

export interface StoreDomainItem {
    id: string;
    domain: string;
    isPrimary: boolean;
    status: 'PENDING' | 'ACTIVE';
    verificationRecordName: string;
    verificationRecordValue: string;
    verifiedAt: string | null;
    lastVerificationError: string | null;
}

export interface StoreDomainsResult {
    storeDomains: StoreDomainItem[];
    storeDomainConfiguration: {
        cnameTarget: string;
        routingMode: string;
    };
}
