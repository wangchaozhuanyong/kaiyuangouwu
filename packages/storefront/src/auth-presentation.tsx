import { createContext } from 'react';

export type AuthPresentationRoute = { name: 'login' | 'register' | 'forgot-password' };

/** Presentation only: the host owns navigation and any in-memory email draft. */
export interface AuthPresentationValue {
    navigate: (route: AuthPresentationRoute, replace?: boolean) => void;
    emailDraft?: string;
    onEmailDraftChange?: (email: string) => void;
    onSubmittingChange?: (submitting: boolean) => void;
}

export const AuthPresentationContext = createContext<AuthPresentationValue | null>(null);
