import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { expect, userEvent, within } from 'storybook/test';
import { FormFieldWrapper } from './form-field-wrapper.js';

const meta = {
    title: 'Framework/FormFieldWrapper',
    component: FormFieldWrapper,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof FormFieldWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Validation: Story = {
    render: () => {
        const form = useForm({ defaultValues: { email: '' } });
        return (
            <PageContext.Provider value={{ pageId: 'form-field-wrapper-story' }}>
                <form className="w-80 space-y-4" onSubmit={form.handleSubmit(() => undefined)}>
                    <FormFieldWrapper
                        control={form.control}
                        name="email"
                        label="Email"
                        description="Used for order notifications"
                        rules={{ required: 'Email is required' }}
                        render={({ field }) => <Input {...field} />}
                    />
                    <Button type="submit">Validate</Button>
                </form>
            </PageContext.Provider>
        );
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const input = canvas.getByRole('textbox', { name: 'Email' });
        await expect(input).toHaveAttribute('aria-describedby', 'field-email-description');

        await userEvent.click(canvas.getByRole('button', { name: 'Validate' }));
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await expect(input).toHaveAttribute('aria-describedby', 'field-email-description field-email-error');
        await expect(canvas.getByText('Email is required')).toHaveAttribute('id', 'field-email-error');
    },
};
