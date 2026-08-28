import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { lazy, Suspense, useMemo } from 'react';

const RichTextEditor = lazy(() =>
    import('../shared/rich-text-editor/rich-text-editor.js').then(module => ({
        default: module.RichTextEditor,
    })),
);

/**
 * @description
 * A component for displaying a rich text editor. Internally uses ProseMirror (rich text editor) under the hood.
 *
 * @docsCategory form-components
 * @docsPage RichTextInput
 */
export function RichTextInput({
    value,
    onChange,
    fieldDef,
    disabled,
    placeholder,
    id,
    'aria-describedby': ariaDescribedBy,
    'aria-errormessage': ariaErrorMessage,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    required,
}: Readonly<DashboardFormComponentProps & { placeholder?: string }>) {
    const readOnly = isFieldDisabled(disabled, fieldDef);
    const strippedPlaceholder = useMemo(
        () =>
            placeholder
                ? new DOMParser().parseFromString(placeholder, 'text/html').body.textContent?.trim() ||
                  undefined
                : undefined,
        [placeholder],
    );

    return (
        <Suspense
            fallback={<div className="min-h-16 w-full rounded-md border bg-muted/30" aria-busy="true" />}
        >
            <RichTextEditor
                value={value}
                onChange={onChange}
                disabled={readOnly}
                placeholder={strippedPlaceholder}
                id={id}
                aria-describedby={ariaDescribedBy}
                aria-errormessage={ariaErrorMessage}
                aria-invalid={ariaInvalid}
                aria-required={ariaRequired ?? (required || undefined)}
            />
        </Suspense>
    );
}

RichTextInput.metadata = {
    isFullWidth: true,
};
