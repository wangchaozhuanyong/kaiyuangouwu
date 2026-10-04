import { describe, expect, it } from 'vitest';

import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';

describe('IcloudOtpExtractorService', () => {
    const extractor = new IcloudOtpExtractorService();

    it('should extract Chinese-style verification codes', () => {
        expect(extractor.extractCode('验证码: 849201', '')).toBe('849201');
        expect(extractor.extractCode('', '您的验证码为：385726，有效期5分钟')).toBe('385726');
        expect(extractor.extractCode('', '动态码：9527')).toBe('9527');
    });

    it('should extract English-style verification codes', () => {
        expect(extractor.extractCode('Your verification code is 123456', '')).toBe('123456');
        expect(extractor.extractCode('', 'Your code is: 789012')).toBe('789012');
        expect(extractor.extractCode('', 'OTP: 654321')).toBe('654321');
    });

    it('extracts the numeric code instead of the ChatGPT heading', () => {
        const subject = 'Your temporary ChatGPT verification code';
        const body = `${subject}\n\nChatGPT\n\nEnter this temporary verification code to continue:\n\n482913`;
        expect(extractor.extractCode(subject, body)).toBe('482913');
    });

    it.each(['ChatGPT', 'continue', 'expired'])('does not treat %s as a code', word => {
        expect(extractor.extractCode('', `Your verification code: ${word}`)).toBeNull();
    });

    it('skips ordinary words and finds a later alphanumeric code', () => {
        expect(
            extractor.extractCode(
                '',
                'Your verification code is expired.\nYour verification code is: AB12CD',
            ),
        ).toBe('AB12CD');
    });

    it('does not truncate an overlong code into a valid candidate', () => {
        expect(extractor.extractCode('Verification code: 123456789', '')).toBeNull();
        expect(extractor.extractCode('', '验证码：AB123456789')).toBeNull();
    });

    it('should extract bracketed codes', () => {
        expect(extractor.extractCode('', '【847291】')).toBe('847291');
        expect(extractor.extractCode('', 'Your code is [382749]')).toBe('382749');
    });

    it('should extract standalone 6-digit codes from subject', () => {
        expect(extractor.extractCode('GitHub: 582941', '')).toBe('582941');
    });

    it('should ignore common years', () => {
        // Standalone year in subject without keywords should be filtered
        expect(extractor.extractCode('Report for 2025', '')).toBeNull();
        expect(extractor.extractCode('Report for 2026', '')).toBeNull();
    });

    it('should return null when no code found', () => {
        expect(extractor.extractCode('Newsletter Update', 'Check out our latest deals!')).toBeNull();
        expect(extractor.extractCode('', '')).toBeNull();
    });

    it('should prioritize subject over body', () => {
        const result = extractor.extractCode('验证码: 111111', '验证码: 222222');
        expect(result).toBe('111111');
    });
});
