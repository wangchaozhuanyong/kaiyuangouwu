import { Request, Response } from 'express';
import ms from 'ms';

import { AuthOptions } from '../../config/vendure-config';

/**
 * Sets the authToken either as a cookie or as a response header, depending on the
 * config settings.
 */
export function setSessionToken(options: {
    sessionToken: string;
    rememberMe: boolean;
    authOptions: Required<AuthOptions>;
    req: Request;
    res: Response;
}) {
    const { sessionToken, rememberMe, authOptions, req, res } = options;
    const usingCookie =
        authOptions.tokenMethod === 'cookie' ||
        (Array.isArray(authOptions.tokenMethod) && authOptions.tokenMethod.includes('cookie'));
    const usingBearer =
        authOptions.tokenMethod === 'bearer' ||
        (Array.isArray(authOptions.tokenMethod) && authOptions.tokenMethod.includes('bearer'));

    if (usingCookie) {
        if (req.session) {
            if (rememberMe) {
                req.sessionOptions.maxAge = ms('1y');
            }
            req.session.token = sessionToken;
        }
    }
    // GraphQL can resolve top-level fields concurrently. If another field has
    // already completed the response, attempting to clear an invalid bearer
    // token here would throw ERR_HTTP_HEADERS_SENT and hide the real auth error.
    if (usingBearer && !res.headersSent) {
        res.set(authOptions.authTokenHeaderKey, sessionToken);
    }
}
