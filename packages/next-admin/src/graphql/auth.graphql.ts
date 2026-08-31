import { gql } from '@apollo/client';

export const COMPLETE_INITIAL_PASSWORD_CHANGE_MUTATION = gql`
    mutation NextAdminCompleteInitialPasswordChange($password: String!) {
        completeInitialPasswordChange(password: $password) {
            mustChangePassword
        }
    }
`;

export const CHANNEL_SWITCHER_QUERY = gql`
    query NextAdminChannelSwitcher($options: ChannelListOptions) {
        activeChannel {
            id
            code
            token
            defaultCurrencyCode
            defaultLanguageCode
        }
        channels(options: $options) {
            items {
                id
                code
                token
                defaultCurrencyCode
                defaultLanguageCode
            }
            totalItems
        }
    }
`;

export const ACTIVE_ADMINISTRATOR_PROFILE_QUERY = gql`
    query NextAdminActiveAdministratorProfile {
        activeAdministrator {
            id
            createdAt
            updatedAt
            firstName
            lastName
            emailAddress
            user {
                id
                identifier
                verified
                lastLogin
                authenticationMethods {
                    id
                    strategy
                    createdAt
                }
                roles {
                    id
                    code
                    description
                    channels {
                        id
                        code
                    }
                }
            }
        }
    }
`;

export const APP_SHELL_BOOTSTRAP_QUERY = gql`
    query NextAdminAppShellBootstrap($options: ChannelListOptions) {
        activeAdministrator {
            id
            createdAt
            updatedAt
            firstName
            lastName
            emailAddress
            user {
                id
                identifier
                verified
                lastLogin
                authenticationMethods {
                    id
                    strategy
                    createdAt
                }
                roles {
                    id
                    code
                    description
                    channels {
                        id
                        code
                    }
                }
            }
        }
        activeChannel {
            id
            code
            token
            defaultCurrencyCode
            defaultLanguageCode
        }
        channels(options: $options) {
            items {
                id
                code
                token
                defaultCurrencyCode
                defaultLanguageCode
            }
            totalItems
        }
    }
`;

export const UPDATE_ACTIVE_ADMINISTRATOR_MUTATION = gql`
    mutation NextAdminUpdateActiveAdministrator($input: UpdateActiveAdministratorInput!) {
        updateActiveAdministrator(input: $input) {
            id
            updatedAt
            firstName
            lastName
            emailAddress
        }
    }
`;

export interface ActiveAdministratorProfile {
    id: string;
    createdAt: string;
    updatedAt: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    user: {
        id: string;
        identifier: string;
        verified: boolean;
        lastLogin: string | null;
        authenticationMethods: Array<{ id: string; strategy: string; createdAt: string }>;
        roles: Array<{
            id: string;
            code: string;
            description: string;
            channels: Array<{ id: string; code: string }>;
        }>;
    };
}

export interface ActiveAdministratorProfileData {
    activeAdministrator: ActiveAdministratorProfile | null;
}

export interface UpdateActiveAdministratorData {
    updateActiveAdministrator: Pick<
        ActiveAdministratorProfile,
        'id' | 'updatedAt' | 'firstName' | 'lastName' | 'emailAddress'
    >;
}

export interface CompleteInitialPasswordChangeData {
    completeInitialPasswordChange: {
        mustChangePassword: boolean;
    };
}

export interface AdministrationChannel {
    id: string;
    code: string;
    token: string;
    defaultCurrencyCode: string;
    defaultLanguageCode: string;
}

export interface ChannelSwitcherData {
    activeChannel: AdministrationChannel;
    channels: {
        items: AdministrationChannel[];
        totalItems: number;
    };
}

export type AppShellBootstrapData = ActiveAdministratorProfileData & ChannelSwitcherData;
