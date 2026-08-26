import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CollectionVisibilitySwitch } from './collection-visibility-switch.js';

const mocks = vi.hoisted(() => ({
    mutate: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));

vi.mock('@/vdb/components/ui/switch.js', () => ({
    Switch: ({
        checked,
        disabled,
        onCheckedChange,
        'aria-label': ariaLabel,
    }: {
        checked: boolean;
        disabled?: boolean;
        onCheckedChange: (checked: boolean) => void;
        'aria-label'?: string;
    }) => (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => onCheckedChange(!checked)}
        />
    ),
}));

vi.mock('@/vdb/graphql/api.js', () => ({
    api: {
        mutate: mocks.mutate,
    },
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        success: mocks.toastSuccess,
    },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CollectionVisibilitySwitch', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        i18n.load('en', {
            'Collection is now hidden from the storefront': 'Collection is now hidden from the storefront',
            'Collection is now visible in the storefront': 'Collection is now visible in the storefront',
            'Failed to update storefront visibility': 'Failed to update storefront visibility',
            Hidden: 'Hidden',
            Visible: 'Visible',
            '{0} storefront visibility': '{0} storefront visibility',
        });
        i18n.activate('en');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    async function renderSwitch(onVisibilityUpdated = vi.fn()) {
        await act(async () => {
            root.render(
                <I18nProvider i18n={i18n}>
                    <CollectionVisibilitySwitch
                        collection={{ id: 'collection-1', name: 'Computers', isPrivate: false }}
                        onVisibilityUpdated={onVisibilityUpdated}
                    />
                </I18nProvider>,
            );
            await Promise.resolve();
        });
        return onVisibilityUpdated;
    }

    function getSwitch() {
        const element = container.querySelector('[role="switch"]');
        expect(element).not.toBeNull();
        return element as HTMLButtonElement;
    }

    async function clickSwitch() {
        await act(async () => {
            getSwitch().dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
    }

    it('updates immediately and keeps the server-confirmed value', async () => {
        let resolveMutation: (value: unknown) => void = () => undefined;
        mocks.mutate.mockReturnValue(
            new Promise(resolve => {
                resolveMutation = resolve;
            }),
        );
        const onVisibilityUpdated = await renderSwitch();

        await clickSwitch();

        expect(getSwitch().getAttribute('aria-checked')).toBe('false');
        expect(getSwitch().disabled).toBe(true);
        expect(container.textContent).toContain('Hidden');

        await act(async () => {
            resolveMutation({ updateCollection: { id: 'collection-1', isPrivate: true } });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getSwitch().getAttribute('aria-checked')).toBe('false');
        expect(getSwitch().disabled).toBe(false);
        expect(onVisibilityUpdated).toHaveBeenCalledWith({ id: 'collection-1', isPrivate: true });
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Collection is now hidden from the storefront');
    });

    it('rolls the switch back when the update fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.mutate.mockRejectedValue(new Error('Network error'));
        const onVisibilityUpdated = await renderSwitch();

        await clickSwitch();
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getSwitch().getAttribute('aria-checked')).toBe('true');
        expect(container.textContent).toContain('Visible');
        expect(onVisibilityUpdated).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to update storefront visibility');
    });
});
