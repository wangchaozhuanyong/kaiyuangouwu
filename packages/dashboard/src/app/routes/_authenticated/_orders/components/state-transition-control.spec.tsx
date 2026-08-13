import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StateTransitionControl, type StateTransitionAction } from './state-transition-control.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StateTransitionControl', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        i18n.load('en', { Cancel: 'Cancel', Continue: 'Continue' });
        i18n.activate('en');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    async function renderControl(action: StateTransitionAction) {
        await act(async () => {
            root.render(
                <I18nProvider i18n={i18n}>
                    <StateTransitionControl
                        currentState="Pending"
                        statesTranslationFunction={state => state}
                        actions={[action]}
                    />
                </I18nProvider>,
            );
            await Promise.resolve();
        });
    }

    async function click(element: Element) {
        await act(async () => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
    }

    function requireElement(selector: string, rootElement: ParentNode = document): Element {
        const element = rootElement.querySelector(selector);
        expect(element).not.toBeNull();
        if (!element) {
            throw new Error(`Expected element matching ${selector}`);
        }
        return element;
    }

    it('waits for confirmation before running a destructive action', async () => {
        const onClick = vi.fn();
        await renderControl({
            label: 'Cancel payment',
            type: 'destructive',
            onClick,
            confirmation: {
                title: 'Cancel payment',
                description: 'This action cannot be undone.',
                confirmText: 'Confirm cancellation',
            },
        });

        await click(requireElement('[data-testid="state-transition-trigger"]', container));
        await click(requireElement('[role="menuitem"]'));

        expect(onClick).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
            'This action cannot be undone.',
        );

        const confirmButton = [...document.querySelectorAll('button')].find(
            button => button.textContent === 'Confirm cancellation',
        );
        expect(confirmButton).toBeDefined();
        if (confirmButton) {
            await click(confirmButton);
        }
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('runs an action without confirmation immediately', async () => {
        const onClick = vi.fn();
        await renderControl({ label: 'Ship order', onClick });

        await click(requireElement('[data-testid="state-transition-trigger"]', container));
        await click(requireElement('[role="menuitem"]'));

        expect(onClick).toHaveBeenCalledOnce();
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });
});
