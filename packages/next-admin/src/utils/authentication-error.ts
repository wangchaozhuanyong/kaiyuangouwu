import { CombinedGraphQLErrors } from '@apollo/client/errors';

const authenticationRequiredPattern =
    /you are not currently authorized to perform this action|authentication required|invalid authentication|你当前无权执行此操作/i;

interface AuthenticationError {
    message?: string;
    statusCode?: number;
    networkError?: { statusCode?: number };
    errors?: ReadonlyArray<{
        path?: ReadonlyArray<string | number>;
        extensions?: { code?: string };
    }>;
    graphQLErrors?: AuthenticationError['errors'];
}

export function isAuthenticationRequiredError(error: unknown): boolean {
    if (error && typeof error === 'object') {
        const candidate = error as AuthenticationError;
        if (candidate.statusCode === 401 || candidate.networkError?.statusCode === 401) return true;
        const errors = candidate.errors ?? candidate.graphQLErrors;
        if (Array.isArray(errors) && errors.length) {
            return errors.some(item => {
                if (item.extensions?.code === 'UNAUTHENTICATED') return true;
                // These bootstrap fields require only an authenticated session.
                // A business-field FORBIDDEN must keep its permission error screen.
                return (
                    item.extensions?.code === 'FORBIDDEN' &&
                    item.path?.length === 1 &&
                    (item.path[0] === 'me' || item.path[0] === 'merchantInitialPasswordStatus')
                );
            });
        }
        return authenticationRequiredPattern.test(candidate.message ?? '');
    }
    return authenticationRequiredPattern.test(String(error ?? ''));
}

// This result must come from the dedicated, unaliased Admin API `me` query.
// That resolver reports FORBIDDEN for anonymous sessions and non-admin identities.
export function isMissingAdminSession(
    data: { me: { id: string } | null } | null | undefined,
    error: unknown,
) {
    if (data?.me) return false;
    if (!error) return data?.me === null;
    return (
        CombinedGraphQLErrors.is(error) &&
        error.errors.length > 0 &&
        error.errors.every(
            item =>
                item.path?.length === 1 &&
                item.path[0] === 'me' &&
                (item.extensions?.code === 'FORBIDDEN' || item.extensions?.code === 'UNAUTHENTICATED'),
        )
    );
}
