import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './input.js';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './field.js';

const meta = {
    title: 'UI/Field',
    component: Field,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    argTypes: {
        orientation: {
            control: 'inline-radio',
            options: ['vertical', 'horizontal', 'responsive'],
            description: 'Controls how the label, control and messages are arranged.',
        },
    },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Validation: Story = {
    render: () => (
        <FieldGroup className="w-[360px]">
            <Field data-invalid="true">
                <FieldLabel htmlFor="field-email">Email address</FieldLabel>
                <Input
                    id="field-email"
                    type="email"
                    defaultValue="invalid-email"
                    aria-invalid="true"
                    aria-describedby="field-email-description field-email-error"
                />
                <FieldDescription id="field-email-description">Used for order notifications.</FieldDescription>
                <FieldError id="field-email-error">Enter a valid email address.</FieldError>
            </Field>
        </FieldGroup>
    ),
};
