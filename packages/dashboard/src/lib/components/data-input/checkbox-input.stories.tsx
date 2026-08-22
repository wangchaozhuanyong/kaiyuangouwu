import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { expect, within } from 'storybook/test';
import { withDescription } from '../../../.storybook/with-description.js';
import { CheckboxInput } from './checkbox-input.js';

const meta = {
    title: 'Form Inputs/CheckboxInput',
    component: CheckboxInput,
    ...withDescription(import.meta.url, './checkbox-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'boolean',
            description: 'Whether the checkbox is checked',
        },
    },
} satisfies Meta<typeof CheckboxInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="flex items-center gap-2">
                <CheckboxInput {...field} {...args} id="accept-terms" />
                <label htmlFor="accept-terms" className="text-sm font-medium">
                    Accept terms and conditions
                </label>
            </div>
        );
    },
    play: async ({ canvasElement }) => {
        const checkbox = within(canvasElement).getByRole('checkbox', {
            name: 'Accept terms and conditions',
        });
        await expect(checkbox).toBeVisible();
        const nativeInput = canvasElement.querySelector('input[name="playground"]');
        await expect(nativeInput).toHaveAttribute('id', 'accept-terms');
    },
};

export const MultipleCheckboxes: Story = {
    render: () => {
        const { register } = useForm();
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <CheckboxInput {...register('notifications')} id="notifications" />
                    <label htmlFor="notifications" className="text-sm font-medium">
                        Email notifications
                    </label>
                </div>
                <div className="flex items-center gap-2">
                    <CheckboxInput {...register('marketing')} id="marketing" />
                    <label htmlFor="marketing" className="text-sm font-medium">
                        Marketing emails
                    </label>
                </div>
                <div className="flex items-center gap-2">
                    <CheckboxInput {...register('updates')} id="updates" />
                    <label htmlFor="updates" className="text-sm font-medium">
                        Product updates
                    </label>
                </div>
            </div>
        );
    },
};
