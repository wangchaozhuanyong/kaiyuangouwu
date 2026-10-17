import type { ShopAbuseAction, ShopAbuseChallenge, ShopAbuseProof } from '../../shop-abuse';
import type { StorefrontLanguage } from '../../types';

export type ShopAbuseChallengeState = {
    action: ShopAbuseAction;
    target: string;
    challenge?: ShopAbuseChallenge;
    answer: string;
    loading: boolean;
    error: string;
    retryAfterSeconds?: number;
    feedbackOnly?: boolean;
};
export type ShopAbuseChallengeResult<T> = { executed: true; value: T } | { executed: false };

export interface ShopAbuseChallengeController {
    state: ShopAbuseChallengeState | null;
    execute<T>(
        action: ShopAbuseAction,
        target: string,
        work: (proof?: ShopAbuseProof) => Promise<T>,
    ): Promise<ShopAbuseChallengeResult<T>>;
    reset: () => void;
    setAnswer: (answer: string) => void;
    refresh: () => void;
}
export interface ShopAbuseChallengeControlProps {
    challenge: ShopAbuseChallengeController;
    language: StorefrontLanguage;
    onSubmit?: (form: HTMLFormElement | null) => void;
    google?: boolean;
    submitLabel?: string;
}
