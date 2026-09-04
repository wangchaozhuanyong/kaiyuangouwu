// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { publishAdminFeedback } from '../utils/admin-feedback';
import { AdminFeedbackCenter } from './AdminFeedbackCenter';

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<AdminFeedbackCenter />));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('AdminFeedbackCenter', () => {
    it('updates one pending notification into one accessible success notification', () => {
        act(() => {
            publishAdminFeedback({ id: 'save-profile', kind: 'loading', title: '保存中…' });
            publishAdminFeedback({ id: 'save-profile', kind: 'success', title: '保存成功' });
        });

        const statuses = container.querySelectorAll('[role="status"]');
        expect(statuses).toHaveLength(1);
        expect(statuses[0]?.textContent).toContain('保存成功');
        expect(container.textContent).not.toContain('保存中');
    });

    it('explains native form validation failures globally', () => {
        const firstInput = document.createElement('input');
        const secondInput = document.createElement('input');
        firstInput.required = true;
        firstInput.setAttribute('aria-label', '店铺名称');
        secondInput.required = true;
        secondInput.setAttribute('aria-label', '联系人');
        document.body.append(firstInput, secondInput);

        act(() => {
            firstInput.dispatchEvent(new Event('invalid', { cancelable: true }));
            secondInput.dispatchEvent(new Event('invalid', { cancelable: true }));
        });

        const alert = container.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('暂时无法提交');
        expect(alert?.textContent).toContain('“店铺名称”为必填项');
        expect(alert?.textContent).not.toContain('联系人');
        firstInput.remove();
        secondInput.remove();
    });
});
