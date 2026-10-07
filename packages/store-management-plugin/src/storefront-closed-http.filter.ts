import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import { StorefrontClosedError } from './storefront-activation.service';

export function sendStorefrontClosedResponse(response: Response, graphQl = false): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const message = 'Store not open yet';
    response.status(403).json({
        errorCode: 'STOREFRONT_CLOSED',
        message,
        ...(graphQl ? { errors: [{ message, extensions: { code: 'STOREFRONT_CLOSED' } }] } : {}),
    });
}

@Catch(StorefrontClosedError)
export class StorefrontClosedHttpFilter implements ExceptionFilter<StorefrontClosedError> {
    catch(_error: StorefrontClosedError, host: ArgumentsHost): void {
        sendStorefrontClosedResponse(host.switchToHttp().getResponse<Response>());
    }
}
