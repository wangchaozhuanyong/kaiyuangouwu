import { createContext, type ReactNode, useState } from 'react';

export type AuthPresentationRoute = { name: 'login' | 'register' | 'forgot-password' };

interface AuthEmailDraftValue {
    emailDraft?: string;
    onEmailDraftChange?: (email: string) => void;
}

/** Presentation only: the host owns navigation and any in-memory email draft. */
export interface AuthPresentationValue extends AuthEmailDraftValue {
    navigate: (route: AuthPresentationRoute, replace?: boolean) => void;
    onSubmittingChange?: (submitting: boolean) => void;
}

export const AuthPresentationContext = createContext<AuthPresentationValue | null>(null);

/** Standalone authentication routes share only an email draft, never credentials or storage. */
export const AuthEmailDraftContext = createContext<AuthEmailDraftValue | null>(null);

export function AuthEmailDraftBoundary({
    active,
    ownerKey,
    children,
}: {
    active: boolean;
    ownerKey: string;
    children: ReactNode;
}) {
    return active ? <AuthEmailDraftScope key={ownerKey}>{children}</AuthEmailDraftScope> : children;
}

function AuthEmailDraftScope({ children }: { children: ReactNode }) {
    const [emailDraft, onEmailDraftChange] = useState('');
    return (
        <AuthEmailDraftContext.Provider value={{ emailDraft, onEmailDraftChange }}>
            {children}
        </AuthEmailDraftContext.Provider>
    );
}
