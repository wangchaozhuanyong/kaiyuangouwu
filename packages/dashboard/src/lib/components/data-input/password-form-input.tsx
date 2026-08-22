import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField } from '@/vdb/framework/form-engine/utils.js';
import { PasswordInput } from '../ui/password-input.js';

/**
 * @description
 * A component for displaying a password input.
 *
 * @docsCategory form-components
 * @docsPage PasswordInput
 */
export function PasswordFormInput(props: Readonly<DashboardFormComponentProps>) {
    const { value, onChange, fieldDef, disabled, ...controlProps } = props;
    const readOnly = disabled || isReadonlyField(fieldDef);
    return (
        <PasswordInput
            {...controlProps}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={readOnly}
        />
    );
}
