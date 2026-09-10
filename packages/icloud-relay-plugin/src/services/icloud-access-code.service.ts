import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const SAFE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

@Injectable()
export class IcloudAccessCodeService {
    /**
     * Generates a random, unambiguous query code
     * Format example: BUY-8X2K-9P7Q or MSTR-4V9W-2H7K
     */
    generateCode(prefix: 'BUY' | 'MSTR' = 'BUY'): string {
        const seg1 = this.randomChars(4);
        const seg2 = this.randomChars(4);
        return `${prefix}-${seg1}-${seg2}`;
    }

    private randomChars(len: number): string {
        const bytes = crypto.randomBytes(len);
        let result = '';
        for (let i = 0; i < len; i++) {
            result += SAFE_CHARSET[bytes[i] % SAFE_CHARSET.length];
        }
        return result;
    }

    /**
     * Calculates the expiration date given an interval in days
     */
    calculateExpiration(days: number): Date | null {
        if (!days || days <= 0) {
            return null;
        }
        const now = new Date();
        now.setDate(now.getDate() + days);
        return now;
    }

    /**
     * Checks if a code has expired
     */
    isExpired(expiresAt: Date | null | undefined): boolean {
        if (!expiresAt) {
            return false;
        }
        return new Date() > new Date(expiresAt);
    }

    /**
     * Returns remaining days until expiration, or null if no expiration
     */
    getRemainingDays(expiresAt: Date | null | undefined): number | null {
        if (!expiresAt) {
            return null;
        }
        const diffMs = new Date(expiresAt).getTime() - Date.now();
        if (diffMs <= 0) {
            return 0;
        }
        return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }
}
