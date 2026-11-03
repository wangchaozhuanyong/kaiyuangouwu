import { gql } from 'graphql-tag';

export const environmentMonitorSchema = gql`
    type EnvironmentNetworkReport {
        checkedAt: String!
        provider: String!
        ip: String!
        ipv4: String
        ipv6: String
        addressSource: String
        maskedIp: String!
        cached: Boolean!
        lookupIssue: String
        country: String
        countryCode: String
        region: String
        city: String
        postalCode: String
        latitude: Float
        longitude: Float
        geoProvider: String
        timezone: String
        isp: String
        asn: String
        connectionType: String
        fraudScore: Float
        proxy: Boolean
        vpn: Boolean
        tor: Boolean
    }
    extend type Query {
        environmentNetworkReport(observedIpv4: String, observedIpv6: String): EnvironmentNetworkReport!
    }
`;
