import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FormFieldWrapper } from './form-field-wrapper.js';

vi.mock('@/vdb/components/help/field-help-button.js', () => ({
    FieldHelpButton: () => null,
}));

vi.mock('@/vdb/framework/form-engine/overridden-form-component.js', () => ({
    OverriddenFormComponent: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/vdb/framework/layout-engine/location-wrapper.js', () => ({
    LocationWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('react-hook-form', async importOriginal => {
    const original = await importOriginal<typeof import('react-hook-form')>();
    return {
        ...original,
        Controller: ({ name, render }: { name: string; render: (args: any) => React.ReactNode }) =>
            render({
                field: {
                    name,
                    value: '',
                    onChange: vi.fn(),
                    onBlur: vi.fn(),
                    ref: vi.fn(),
                },
                fieldState: {
                    invalid: true,
                    error: { type: 'required', message: 'Email is required' },
                },
            }),
    };
});

describe('FormFieldWrapper accessibility wiring', () => {
    it('connects the label, description, and error to the rendered control', () => {
        const markup = renderToStaticMarkup(
            <FormFieldWrapper
                control={undefined}
                name="email"
                label="Email"
                description="Used for order notifications"
                render={({ field }) => <input {...field} aria-describedby="consumer-hint" />}
            />,
        );
        document.body.innerHTML = markup;

        const control = document.querySelector('input');
        expect(control?.getAttribute('id')).toBe('field-email');
        expect(control?.getAttribute('aria-invalid')).toBe('true');
        expect(control?.getAttribute('aria-describedby')).toBe(
            'consumer-hint field-email-description field-email-error',
        );
        expect(control?.getAttribute('aria-errormessage')).toBe('field-email-error');
        expect(document.querySelector('label')?.getAttribute('for')).toBe('field-email');
        expect(document.getElementById('field-email-description')?.textContent).toBe(
            'Used for order notifications',
        );
        expect(document.getElementById('field-email-error')?.textContent).toBe('Email is required');
    });
});
