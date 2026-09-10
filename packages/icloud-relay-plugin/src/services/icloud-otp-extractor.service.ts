import { Injectable } from '@nestjs/common';

@Injectable()
export class IcloudOtpExtractorService {
    private readonly patterns: RegExp[] = [
        // Chinese keyword patterns
        /(?:验证码|校验码|动态码|确认码|激活码)[：:\s*#]*([0-9A-Za-z]{4,8})/i,
        /您的验证码(?:为|是)?[:：\s]*([0-9A-Za-z]{4,8})/i,
        /验证码.*?([0-9]{4,8}).*?有效/i,

        // English keyword patterns
        /(?:verification code|security code|confirmation code|one-time code|auth code|login code|access code)[：:\s*#]*([0-9A-Za-z]{4,8})/i,
        /(?:your code is|enter code|use code|code is)[:：\s*#]*([0-9A-Za-z]{4,8})/i,
        /(?:OTP|PIN)[:：\s*#]*([0-9]{4,8})/i,

        // Bracketed patterns e.g. 【123456】 or [123456]
        /【([0-9]{4,8})】/,
        /\[([0-9]{4,8})\]/,

        // Standalone 6-digit number in subject line (common in platforms like GitHub, Google, Apple, Amazon)
        /\b([0-9]{6})\b/,
    ];

    /**
     * Extracts the most likely verification code from subject and body
     */
    extractCode(subject: string, bodyText: string): string | null {
        const fullContent = `${subject || ''}\n${bodyText || ''}`;
        if (!fullContent.trim()) {
            return null;
        }

        // 1. Try high-confidence keyword patterns on subject first
        for (const pattern of this.patterns) {
            const match = (subject || '').match(pattern);
            if (match && match[1] && this.isValidCodeCandidate(match[1])) {
                return match[1].trim();
            }
        }

        // 2. Try patterns on body text
        for (const pattern of this.patterns) {
            const match = fullContent.match(pattern);
            if (match && match[1] && this.isValidCodeCandidate(match[1])) {
                return match[1].trim();
            }
        }

        return null;
    }

    private isValidCodeCandidate(code: string): boolean {
        const cleaned = code.trim();
        // Ignore common years (e.g. 2024, 2025, 2026)
        if (cleaned.length === 4 && (cleaned.startsWith('19') || cleaned.startsWith('20'))) {
            return false;
        }
        return cleaned.length >= 4 && cleaned.length <= 8;
    }
}
