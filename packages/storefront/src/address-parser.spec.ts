import { describe, expect, it } from 'vitest';

import { smartParseAddressText } from './address-parser';

describe('smartParseAddressText', () => {
    it('parses typical Chinese address string with commas', () => {
        const input = '张三，13800138000，广东省深圳市南山区高新南九道科技园 518000';
        const result = smartParseAddressText(input);

        expect(result.fullName).toBe('张三');
        expect(result.phoneNumber).toBe('13800138000');
        expect(result.province).toBe('广东省');
        expect(result.city).toBe('深圳市');
        expect(result.postalCode).toBe('518000');
        expect(result.streetLine1).toContain('南山区高新南九道科技园');
    });

    it('parses space-separated address with phone and postal code', () => {
        const input = '李四 18688889999 北京市海淀区中关村南大街1号 100081';
        const result = smartParseAddressText(input);

        expect(result.fullName).toBe('李四');
        expect(result.phoneNumber).toBe('18688889999');
        expect(result.province).toBe('北京市');
        expect(result.postalCode).toBe('100081');
        expect(result.streetLine1).toContain('海淀区中关村南大街1号');
    });

    it('handles empty or whitespace-only input safely', () => {
        const result = smartParseAddressText('   ');
        expect(result.fullName).toBe('');
        expect(result.phoneNumber).toBe('');
    });
});
