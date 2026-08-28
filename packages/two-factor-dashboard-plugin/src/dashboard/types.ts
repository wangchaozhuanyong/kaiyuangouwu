export const MAX_TWO_FACTOR_ACCOUNTS = 100;

export interface TwoFactorAccount {
    id: string;
    projectName: string;
    secret: string;
    createdAt: string;
    lastUsedAt: string | null;
}
