import { gql } from '@apollo/client';

export interface AdminLoginResult {
    status: 'SUCCESS' | 'REQUIRES_2FA' | 'ERROR';
    message: string | null;
    challengeToken: string | null;
    expiresAt: string | null;
    activeChannelToken: string | null;
}

export interface AdminTwoFactorStatus {
    available: boolean;
    enabled: boolean;
    enabledAt: string | null;
    recoveryCodesRemaining: number;
}

export interface AdminTwoFactorSetup {
    secret: string;
    otpauthUri: string;
    expiresAt: string;
}

export const ADMIN_BEGIN_LOGIN = gql`
    mutation AdminBeginLogin($username: String!, $password: String!, $rememberMe: Boolean!) {
        adminBeginLogin(username: $username, password: $password, rememberMe: $rememberMe) {
            status
            message
            challengeToken
            expiresAt
            activeChannelToken
        }
    }
`;

export const ADMIN_COMPLETE_LOGIN = gql`
    mutation AdminCompleteTwoFactorLogin($challengeToken: String!, $code: String!) {
        adminCompleteTwoFactorLogin(challengeToken: $challengeToken, code: $code) {
            status
            message
            activeChannelToken
        }
    }
`;

export const ADMIN_TWO_FACTOR_STATUS = gql`
    query AdminTwoFactorStatus {
        adminTwoFactorStatus {
            available
            enabled
            enabledAt
            recoveryCodesRemaining
        }
    }
`;

export const ADMIN_BEGIN_SETUP = gql`
    mutation AdminBeginTwoFactorSetup($password: String!, $code: String) {
        adminBeginTwoFactorSetup(password: $password, code: $code) {
            secret
            otpauthUri
            expiresAt
        }
    }
`;

export const ADMIN_CONFIRM_SETUP = gql`
    mutation AdminConfirmTwoFactorSetup($password: String!, $code: String!) {
        adminConfirmTwoFactorSetup(password: $password, code: $code) {
            success
            recoveryCodes
        }
    }
`;

export const ADMIN_DISABLE_TWO_FACTOR = gql`
    mutation AdminDisableTwoFactor($password: String!, $code: String!) {
        adminDisableTwoFactor(password: $password, code: $code) {
            success
        }
    }
`;

export const ADMIN_REGENERATE_RECOVERY_CODES = gql`
    mutation AdminRegenerateTwoFactorRecoveryCodes($password: String!, $code: String!) {
        adminRegenerateTwoFactorRecoveryCodes(password: $password, code: $code) {
            success
            recoveryCodes
        }
    }
`;
