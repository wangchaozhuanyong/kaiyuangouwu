import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export interface DigitalDeliveryTokenPayload {
    orderId: string;
    orderLineId: string;
    sku: string;
    expiresAt: number;
}

export interface DigitalDeliveryResource {
    path: string;
    downloadName: string;
}

export interface DigitalDeliveryConfiguration {
    rootDirectory?: string;
    signingSecret?: string;
    linkTtlSeconds?: number;
    production?: boolean;
}

const SAFE_SKU = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const MINIMUM_SECRET_LENGTH = 32;
export const DIGITAL_DELIVERY_CONFIGURATION = 'DIGITAL_DELIVERY_CONFIGURATION';

@Injectable()
export class DigitalDeliveryTokenService {
    private readonly rootDirectory?: string;
    private readonly signingSecret?: string;
    private readonly linkTtlSeconds: number;

    constructor(
        @Optional()
        @Inject(DIGITAL_DELIVERY_CONFIGURATION)
        configuration?: DigitalDeliveryConfiguration,
    ) {
        const production = configuration?.production ?? process.env.NODE_ENV === 'production';
        const configuredRoot = configuration?.rootDirectory ?? process.env.DIGITAL_DELIVERY_ROOT;
        const configuredSecret =
            configuration?.signingSecret ?? process.env.DIGITAL_DELIVERY_SIGNING_SECRET;
        this.rootDirectory =
            configuredRoot?.trim() && (!production || path.isAbsolute(configuredRoot.trim()))
                ? path.resolve(configuredRoot.trim())
                : undefined;
        this.signingSecret = configuredSecret?.trim() && isAcceptableSecret(configuredSecret.trim())
            ? configuredSecret.trim()
            : production
              ? undefined
              : randomBytes(32).toString('base64url');
        const configuredTtl =
            configuration?.linkTtlSeconds ?? Number(process.env.DIGITAL_DELIVERY_LINK_TTL_SECONDS || 300);
        this.linkTtlSeconds = Number.isInteger(configuredTtl)
            ? Math.min(900, Math.max(60, configuredTtl))
            : 300;
    }

    get configured(): boolean {
        return Boolean(
            this.rootDirectory &&
                this.signingSecret &&
                this.signingSecret.length >= MINIMUM_SECRET_LENGTH &&
                existsSync(this.rootDirectory),
        );
    }

    createToken(
        input: Omit<DigitalDeliveryTokenPayload, 'expiresAt'>,
        nowMilliseconds = Date.now(),
    ): { token: string; expiresAt: Date } {
        if (!this.signingSecret || this.signingSecret.length < MINIMUM_SECRET_LENGTH) {
            throw new Error('Digital delivery signing is not configured');
        }
        const payload: DigitalDeliveryTokenPayload = {
            ...input,
            expiresAt: Math.floor(nowMilliseconds / 1000) + this.linkTtlSeconds,
        };
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return {
            token: `${encodedPayload}.${this.signature(encodedPayload)}`,
            expiresAt: new Date(payload.expiresAt * 1000),
        };
    }

    verifyToken(token: string, nowMilliseconds = Date.now()): DigitalDeliveryTokenPayload | undefined {
        if (!this.signingSecret || this.signingSecret.length < MINIMUM_SECRET_LENGTH) {
            return;
        }
        const [encodedPayload, suppliedSignature, extra] = token.split('.');
        if (!encodedPayload || !suppliedSignature || extra) {
            return;
        }
        const expectedSignature = this.signature(encodedPayload);
        const supplied = Buffer.from(suppliedSignature);
        const expected = Buffer.from(expectedSignature);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            return;
        }
        try {
            const payload = JSON.parse(
                Buffer.from(encodedPayload, 'base64url').toString('utf8'),
            ) as DigitalDeliveryTokenPayload;
            if (
                !payload.orderId ||
                !payload.orderLineId ||
                !SAFE_SKU.test(payload.sku) ||
                !Number.isInteger(payload.expiresAt) ||
                payload.expiresAt <= Math.floor(nowMilliseconds / 1000)
            ) {
                return;
            }
            return payload;
        } catch {
            return;
        }
    }

    resourceForSku(sku: string): DigitalDeliveryResource | undefined {
        if (!this.configured || !this.rootDirectory || !SAFE_SKU.test(sku)) {
            return;
        }
        const candidateNames = [`${sku}.zip`, `${sku}.pdf`, `${sku}.txt`, `${sku}.md`];
        for (const candidateName of candidateNames) {
            const candidatePath = path.resolve(this.rootDirectory, candidateName);
            if (!candidatePath.startsWith(`${this.rootDirectory}${path.sep}`)) {
                continue;
            }
            try {
                if (statSync(candidatePath).isFile()) {
                    return { path: candidatePath, downloadName: candidateName };
                }
            } catch {
                // The next supported extension may exist.
            }
        }
    }

    private signature(encodedPayload: string): string {
        return createHmac('sha256', this.signingSecret!).update(encodedPayload).digest('base64url');
    }
}

function isAcceptableSecret(value: string): boolean {
    return (
        value.length >= MINIMUM_SECRET_LENGTH &&
        !/(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value)
    );
}
