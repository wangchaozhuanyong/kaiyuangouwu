import { Injectable } from '@nestjs/common';

@Injectable()
export class IcloudOtpExtractorService {
    private readonly patterns: RegExp[] = [
        // Chinese keyword patterns
        /(?:验证码|校验码|动态码|确认码|激活码)[：:\s*#]*([0-9A-Za-z]{4,8})(?![0-9A-Za-z])/gi,
        /您的验证码(?:为|是)?[:：\s]*([0-9A-Za-z]{4,8})(?![0-9A-Za-z])/gi,
        /验证码.*?\b([0-9]{4,8})\b.*?有效/gi,

        // English keyword patterns
        /\b(?:verification code|security code|confirmation code|one-time code|auth code|login code|access code)\b(?:\s+is)?[：:\s*#]*([0-9A-Za-z]{4,8})(?![0-9A-Za-z])/gi,
        /\b(?:your code is|enter code|use code|code is)\b[:：\s*#]*([0-9A-Za-z]{4,8})(?![0-9A-Za-z])/gi,
        /\b(?:OTP|PIN)\b[:：\s*#]*([0-9]{4,8})(?![0-9A-Za-z])/gi,

        // Bracketed patterns e.g. 【123456】 or [123456]
        /【([0-9]{4,8})】/g,
        /\[([0-9]{4,8})\]/g,

        // Standalone 6-digit number in subject line (common in platforms like GitHub, Google, Apple, Amazon)
        /\b([0-9]{6})\b/g,
    ];

    /**
     * Extracts the most likely verification code from subject and body
     */
    extractCode(subject: string, bodyText: string): string | null {
        // Keep subject priority without matching across the subject/body boundary.
        for (const content of [subject || '', bodyText || '']) {
            for (const pattern of this.patterns) {
                for (const match of content.matchAll(pattern)) {
                    if (match[1] && this.isValidCodeCandidate(match[1])) {
                        return match[1].trim();
                    }
                }
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
        // Pure words (e.g. ChatGPT, continue) are not verification codes.
        return cleaned.length >= 4 && cleaned.length <= 8 && /[0-9]/.test(cleaned);
    }
}
