import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseShopApiResponse, ShopApiError, ShopApiTimeoutError } from './api/helpers';
import { storefrontErrorCopy, storefrontErrorMessage } from './storefront-errors';

describe('customer-facing error language boundary', () => {
    it('covers every supported error in both storefront languages', () => {
        for (const [errorCode, text] of Object.entries(storefrontErrorCopy)) {
            expect(storefrontErrorMessage({ errorCode, message: 'INTERNAL_SERVER_DETAILS' }, 'zh')).toBe(
                text.zh,
            );
            expect(storefrontErrorMessage({ errorCode, message: '服务器内部错误' }, 'en')).toBe(text.en);
            expect(text.zh).toMatch(/\p{Script=Han}/u);
            expect(text.en).not.toMatch(/\p{Script=Han}/u);
            expect(text.zh).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
        }
    });

    it('uses the root cause of legacy cart failures, without mislabeling other projection errors as stock errors', () => {
        expect(
            storefrontErrorMessage(
                new ShopApiError('CART_PROJECTION_ERROR', 'INSUFFICIENT_STOCK_ERROR'),
                'zh',
            ),
        ).toContain('库存不足');
        expect(
            storefrontErrorMessage(new ShopApiError('CART_PROJECTION_ERROR', 'Order cannot be edited'), 'zh'),
        ).not.toContain('库存');
        const error = Object.assign(new ShopApiError('INSUFFICIENT_STOCK_ERROR', 'Out of stock'), {
            selectionRejected: true,
        });
        expect(storefrontErrorMessage(error, 'zh')).toContain('已恢复原来的选择');
        expect(storefrontErrorMessage(error, 'en')).toContain('previous selection has been restored');
        expect(error.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
        expect(error.message).toBe('Out of stock');
    });

    it('keeps uncertain submissions distinct from ordinary timeouts', () => {
        expect(storefrontErrorMessage(new ShopApiTimeoutError('请求超时', true), 'en')).toContain(
            'do not submit again',
        );
        expect(storefrontErrorMessage(new ShopApiTimeoutError('请求超时'), 'en')).toContain('timed out');
        expect(storefrontErrorMessage(new TypeError('Failed to fetch'), 'zh')).toContain('网络连接失败');
    });

    it('retains GraphQL diagnostics while presenting only reviewed localized copy', () => {
        let caught: unknown;
        try {
            parseShopApiResponse(
                JSON.stringify({
                    errors: [{ message: 'private server path', extensions: { code: 'FORBIDDEN' } }],
                }),
                200,
                true,
            );
        } catch (error) {
            caught = error;
        }
        expect(caught).toMatchObject({ message: 'private server path', errorCode: 'FORBIDDEN' });
        expect(storefrontErrorMessage(caught, 'zh')).toContain('确认登录状态');
        expect(storefrontErrorMessage({ message: 'private details', status: 503 }, 'en')).toContain(
            'temporarily unavailable',
        );
    });

    it('never displays unrecognized raw messages or codes, including errors cached in another language', () => {
        for (const error of [
            new Error('数据库内部错误'),
            new Error('SQL driver failed at /private/path'),
            'UNKNOWN_VENDOR_ERROR',
            { unexpected: true },
        ]) {
            expect(storefrontErrorMessage(error, 'zh')).toBe(storefrontErrorCopy.UNKNOWN.zh);
            expect(storefrontErrorMessage(error, 'en')).toBe(storefrontErrorCopy.UNKNOWN.en);
        }
        expect(storefrontErrorMessage(new Error('两次输入的交付邮箱不一致'), 'en')).toContain('do not match');
    });

    it('prevents pages and hooks from rendering raw exception messages again', () => {
        const root = fileURLToPath(new URL('.', import.meta.url));
        const paths = readdirSync(root, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile() && /\.(tsx|ts)$/.test(entry.name) && !/\.spec\./.test(entry.name))
            .map(entry => `${entry.parentPath}/${entry.name}`)
            .filter(path => path.endsWith('.tsx') || path.includes('/hooks/'));
        const violations = paths.filter(path =>
            /\b\w*[Ee]rror\.message\b|\berror\.message\b/.test(readFileSync(path, 'utf8')),
        );
        expect(violations).toEqual([]);
    });
});
