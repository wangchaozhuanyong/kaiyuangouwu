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
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
        channels(options: $options) {
            items {
                id
                code
                token
                defaultCurrencyCode
                defaultLanguageCode
                customFields {
                    storefrontNameZh
                    storefrontNameEn
                }
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
                        customFields {
                            storefrontNameZh
                            storefrontNameEn
                        }
                    }
                }
            }
        }
    }
`;

export const APP_SHELL_BOOTSTRAP_QUERY = gql`
    query NextAdminAppShellBootstrap {
        me {
            id
            identifier
            channels {
                id
                code
                token
                permissions
            }
        }
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
                        customFields {
                            storefrontNameZh
                            storefrontNameEn
                        }
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
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
        manageableChannels {
            id
            code
            token
            defaultCurrencyCode
            defaultLanguageCode
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
    }
`;

// Store presentation data must not prevent permission/bootstrap data from loading when a legacy
// Channel is temporarily missing one of its managed records.
export const APP_SHELL_COMMERCE_CONTEXT_QUERY = gql`
    query NextAdminAppShellCommerceContext {
        myStoreCommerceMode {
            mode
        }
    }
`;

export const APP_SHELL_PROFILE_CONTEXT_QUERY = gql`
    query NextAdminAppShellProfileContext {
        myStoreProfile {
            id
            logoAsset {
                id
                preview
            }
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
            channels: Array<{
                id: string;
                code: string;
                customFields?: {
                    storefrontNameZh?: string | null;
                    storefrontNameEn?: string | null;
                } | null;
            }>;
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
    customFields?: {
        storefrontNameZh?: string | null;
        storefrontNameEn?: string | null;
    } | null;
}

export interface ChannelSwitcherData {
    activeChannel: AdministrationChannel;
    channels: {
        items: AdministrationChannel[];
        totalItems: number;
    };
}

export interface CurrentAdministratorUser {
    id: string;
    identifier: string;
    channels: Array<{
        id: string;
        code: string;
        token: string;
        permissions: string[];
    }>;
}

export type AppShellBootstrapData = ActiveAdministratorProfileData & {
    me: CurrentAdministratorUser | null;
    activeChannel: AdministrationChannel;
    manageableChannels: AdministrationChannel[];
};

export interface AppShellCommerceContextData {
    myStoreCommerceMode?: {
        mode: 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';
    } | null;
}

export interface AppShellProfileContextData {
    myStoreProfile?: {
        id: string;
        logoAsset: { id: string; preview: string } | null;
    } | null;
}
