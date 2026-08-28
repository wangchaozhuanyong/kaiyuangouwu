import { useAuth } from '@vendure/dashboard';
import { ReactNode, useEffect, useRef } from 'react';

import { clearAllTwoFactorSessions } from './session-storage';

export function TwoFactorSessionGuardProvider({ children }: Readonly<{ children: ReactNode }>) {
    const { status, user } = useAuth();
    const previousOwnerId = useRef<string | undefined>(undefined);

    useEffect(() => {
        const ownerId = user?.id;
        if (status === 'unauthenticated') {
            clearAllTwoFactorSessions();
        } else if (ownerId && previousOwnerId.current && ownerId !== previousOwnerId.current) {
            clearAllTwoFactorSessions();
        }
        previousOwnerId.current = ownerId;
    }, [status, user?.id]);

    return children;
}
