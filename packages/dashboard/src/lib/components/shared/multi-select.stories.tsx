import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { MultiSelect } from './multi-select.js';

const items = [
    { value: 'react', label: 'React' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'tailwind', label: 'Tailwind CSS' },
];

const meta = {
    title: 'UI/MultiSelect',
    component: MultiSelect,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof MultiSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Multiple: Story = {
    args: {
        value: [],
        multiple: true,
        items,
        'aria-label': 'Frameworks',
        placeholder: 'Select frameworks',
    },
    render: args => {
        const [value, setValue] = useState<string[]>(args.value as string[]);
        return (
            <div className="w-80">
                <MultiSelect {...args} value={value} onChange={setValue} />
            </div>
        );
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const trigger = canvas.getByRole('combobox', { name: 'Frameworks' });
        await userEvent.click(trigger);
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        const page = within(canvasElement.ownerDocument.body);
        await userEvent.click(page.getByRole('option', { name: /React/ }));
        await expect(trigger).toHaveTextContent('React');
    },
};
