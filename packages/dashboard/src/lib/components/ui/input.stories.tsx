import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Input } from './input.js';

const meta = {
    title: 'UI/Input',
    component: Input,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        type: {
            control: 'select',
            options: ['text', 'email', 'password', 'number', 'tel', 'url'],
            description: 'Input type',
        },
        placeholder: {
            control: 'text',
            description: 'Placeholder text',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
    },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        type: 'text',
        placeholder: 'Enter text...',
        disabled: false,
        id: 'playground-input',
    },
    render: args => (
        <div className="w-[300px] space-y-2">
            <label htmlFor="playground-input" className="text-sm font-medium">
                Example value
            </label>
            <Input {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const input = within(canvasElement).getByRole('textbox', { name: 'Example value' });
        await userEvent.type(input, 'Vendure');
        await expect(input).toHaveValue('Vendure');
    },
};
