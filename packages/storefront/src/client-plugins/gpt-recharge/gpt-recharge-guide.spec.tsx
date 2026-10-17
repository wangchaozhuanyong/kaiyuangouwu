// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inspectRechargeSession } from './contracts';
import { GptRechargeGuide } from './gpt-recharge-guide';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('GPT recharge guide', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    const recharge = vi.fn();
    const query = vi.fn();
    const writeText = vi.fn();

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
        vi.resetAllMocks();
    });
    const render = async (language: 'zh' | 'en' = 'zh') => {
        await act(async () => {
            root.render(<GptRechargeGuide language={language} onRecharge={recharge} onQuery={query} />);
            await Promise.resolve();
        });
    };
    const button = (label: string) => {
        const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item =>
            item.textContent?.includes(label),
        );
        expect(found).toBeDefined();
        if (!found) throw new Error('Expected guide action is missing');
        return found;
    };

    it('copies only the fixed public URL, never example or account data', async () => {
        writeText.mockResolvedValue(undefined);
        await render();
        await act(async () => {
            button('复制页面地址').click();
            await Promise.resolve();
        });
        expect(writeText).toHaveBeenCalledExactlyOnceWith('https://chatgpt.com/api/auth/session');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('公开页面地址');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('仍需复制自己的完整 JSON');
        expect(container.querySelectorAll('[role="img"]')).toHaveLength(2);
        const example = container.querySelector('pre code')?.textContent ?? '';
        expect(JSON.parse(example)).toMatchObject({
            user: { id: 'demo-user-invalid', email: 'demo@example.com' },
        });
        expect(() => inspectRechargeSession(example)).toThrow();
        expect(container.textContent).toContain('演示凭据已遮蔽');
    });
    it('keeps a selectable public URL and an explicit fallback when clipboard access fails', async () => {
        writeText.mockRejectedValue(new Error('Synthetic browser clipboard permission rejection'));
        await render();
        await act(async () => {
            button('复制页面地址').click();
            await Promise.resolve();
        });
        const input = container.querySelector<HTMLInputElement>('input[type="url"]');
        expect(input?.readOnly).toBe(true);
        expect(input?.value).toBe('https://chatgpt.com/api/auth/session');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('手动复制');
        expect(button('复制页面地址').disabled).toBe(false);
    });
    it('uses the selected language, retains FAQ and routes back through the supplied callbacks', async () => {
        await render('en');
        expect(container.querySelectorAll('details')).toHaveLength(5);
        expect(container.querySelectorAll('ol')).toHaveLength(2);
        expect([...container.querySelectorAll('ol')].map(list => list.children.length)).toEqual([4, 4]);
        const links = [...container.querySelectorAll<HTMLAnchorElement>('a')];
        expect(
            links.every(link =>
                ['https://chatgpt.com/', 'https://chatgpt.com/api/auth/session'].includes(link.href),
            ),
        ).toBe(true);
        expect(
            links.every(
                link =>
                    link.target === '_blank' &&
                    link.rel.includes('noopener') &&
                    link.rel.includes('noreferrer'),
            ),
        ).toBe(true);
        act(() => {
            button('Check recharge result').click();
            button('Start recharge').click();
        });
        expect(query).toHaveBeenCalledOnce();
        expect(recharge).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('fictional account');
        expect(container.textContent).toContain('Do not resubmit or pay again');
    });
});
