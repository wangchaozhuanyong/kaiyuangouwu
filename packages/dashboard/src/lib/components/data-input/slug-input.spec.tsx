import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlugInput } from './slug-input.js';

const state = vi.hoisted(() => ({
    watchedValue: 'New product name',
    debouncedValue: 'Old product name',
    generatedSlug: 'old-product-name' as string | undefined,
    isLoading: false,
}));

vi.mock('@/vdb/components/ui/button.js', () => ({
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    ),
}));

vi.mock('@/vdb/components/ui/input.js', () => ({
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/vdb/framework/form-engine/utils.js', () => ({
    isFieldDisabled: () => false,
}));

vi.mock('@/vdb/graphql/api.js', () => ({
    api: { query: vi.fn() },
}));

vi.mock('@/vdb/graphql/graphql.js', () => ({
    graphql: () => ({}),
}));

vi.mock('@/vdb/hooks/use-user-settings.js', () => ({
    useUserSettings: () => ({ settings: { contentLanguage: 'en' } }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: () => ({
        data: state.generatedSlug,
        isLoading: state.isLoading,
        refetch: vi.fn(),
    }),
}));

vi.mock('@uidotdev/usehooks', () => ({
    useDebounce: () => state.debouncedValue,
}));

vi.mock('react-hook-form', () => ({
    useFormContext: () => ({
        control: {},
        getValues: () => ({ name: state.watchedValue }),
        getFieldState: () => ({ isDirty: true }),
    }),
    useWatch: () => state.watchedValue,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SlugInput auto generation', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        state.watchedValue = 'New product name';
        state.debouncedValue = 'Old product name';
        state.generatedSlug = 'old-product-name';
        state.isLoading = false;
        i18n.load('en', {
            'Regenerate slug from source field': 'Regenerate slug from source field',
            'Edit slug manually': 'Edit slug manually',
            'Generate slug automatically': 'Generate slug automatically',
            'Slug is set': 'Slug is set',
            'Slug will be generated automatically...': 'Slug will be generated automatically...',
            'Enter slug manually': 'Enter slug manually',
        });
        i18n.activate('en');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    async function renderSlugInput(value: string, onChange = vi.fn()) {
        await act(async () => {
            root.render(
                <I18nProvider i18n={i18n}>
                    <SlugInput
                        name="slug"
                        value={value}
                        onChange={onChange}
                        entityName="Product"
                        fieldName="slug"
                        watchFieldName="name"
                    />
                </I18nProvider>,
            );
            await Promise.resolve();
        });
        return onChange;
    }

    it('does not clear or restore a stale slug while the watched value is still debouncing', async () => {
        const onChange = await renderSlugInput('old-product-name');

        expect(onChange).not.toHaveBeenCalled();
        expect((container.querySelector('input') as HTMLInputElement | null)?.value).toBe('old-product-name');
    });

    it('keeps the regenerate button mounted while the generated value is empty', async () => {
        state.watchedValue = '';
        state.debouncedValue = '';
        state.generatedSlug = undefined;
        await renderSlugInput('');

        const regenerateButton = container.querySelector(
            'button[aria-label="Regenerate slug from source field"]',
        );
        expect(regenerateButton).not.toBeNull();
        expect((regenerateButton as HTMLButtonElement | null)?.disabled).toBe(true);
    });

    it('writes a generated slug only after it matches the current watched value', async () => {
        state.debouncedValue = state.watchedValue;
        state.generatedSlug = 'new-product-name';
        const onChange = await renderSlugInput('old-product-name');

        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('new-product-name');
    });
});
