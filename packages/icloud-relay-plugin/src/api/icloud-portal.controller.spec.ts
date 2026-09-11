import { describe, expect, it, vi } from 'vitest';

import { IcloudPortalController } from './icloud-portal.controller';

describe('IcloudPortalController', () => {
    const controller = new IcloudPortalController();

    it('serves portal HTML with external script reference and required UI sections', () => {
        const headers: Record<string, string> = {};
        let sentBody = '';

        const res = {
            setHeader: vi.fn((key: string, val: string) => {
                headers[key] = val;
            }),
            send: vi.fn((body: string) => {
                sentBody = body;
            }),
        };

        controller.servePortal(res);

        expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
        expect(headers['Cache-Control']).toBe('no-cache');

        // Verify script is external to comply with strict CSP script-src 'self'
        expect(sentBody).toContain('<script src="/mail-query/portal.js"></script>');
        expect(sentBody).not.toMatch(/<script>[\s\S]+<\/script>/);

        // Verify key UI elements requested by user
        expect(sentBody).toContain('id="pasteBtn"');
        expect(sentBody).toContain('id="clearBtn"');
        expect(sentBody).toContain('id="recentSection"');
        expect(sentBody).toContain('最近查询记录');
        expect(sentBody).toContain('邮件验证码实时查询中心');
        expect(sentBody).toContain('常见问题与使用指南');
        expect(sentBody).toContain('返回商城服务');
    });

    it('serves portal JavaScript with clipboard and recent query features', () => {
        const headers: Record<string, string> = {};
        let sentBody = '';

        const res = {
            setHeader: vi.fn((key: string, val: string) => {
                headers[key] = val;
            }),
            send: vi.fn((body: string) => {
                sentBody = body;
            }),
        };

        controller.serveScript(res);

        expect(headers['Content-Type']).toBe('application/javascript; charset=utf-8');
        expect(headers['Cache-Control']).toBe('public, max-age=300');

        // Verify script contains paste, query and localStorage handling
        expect(sentBody).toContain('window.pasteFromClipboard');
        expect(sentBody).toContain('window.doQuery');
        expect(sentBody).toContain('icloud_relay_recent_queries');
        expect(sentBody).toContain('window.toggleAutoRefresh');
        expect(sentBody).toContain('copyOtpCode');
    });
});
