import { Textarea } from '@/vdb/components/ui/textarea.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField } from '@/vdb/framework/form-engine/utils.js';

/**
 * @description
 * A component for displaying a textarea input.
 *
 * @docsCategory form-components
 * @docsPage TextareaInput
 */
export function TextareaInput(props: Readonly<DashboardFormComponentProps>) {
    const { value, onChange, fieldDef, disabled, ...controlProps } = props;
    const readOnly = disabled || isReadonlyField(fieldDef);
    return (
        <Textarea
            {...controlProps}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={readOnly}
        />
    );
}

TextareaInput.metadata = {
    isFullWidth: true,
};
