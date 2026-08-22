import { Switch } from '@/vdb/components/ui/switch.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';

/**
 * @description
 * Displays a boolean value as a switch toggle.
 *
 * @docsCategory form-components
 * @docsPage BooleanInput
 */
export function BooleanInput({
    value,
    onChange,
    fieldDef,
    disabled,
    ...controlProps
}: Readonly<DashboardFormComponentProps>) {
    const checked = typeof value === 'string' ? value === 'true' : value;
    const readOnly = isFieldDisabled(disabled, fieldDef);
    return <Switch {...controlProps} checked={checked} onCheckedChange={onChange} disabled={readOnly} />;
}
