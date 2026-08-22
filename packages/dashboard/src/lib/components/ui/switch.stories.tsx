import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { Switch } from './switch.js';

const meta = {
    title: 'UI/Switch',
    component: Switch,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        disabled: {
            control: 'boolean',
            description: 'Whether the switch is disabled',
        },
        checked: {
            control: 'boolean',
            description: 'Whether the switch is checked',
        },
    },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        checked: false,
        disabled: false,
    },
    render: args => {
        const [checked, setChecked] = useState(args.checked);
        return (
            <div className="flex items-center gap-2">
                <Switch {...args} id="playground-switch" checked={checked} onCheckedChange={setChecked} />
                <label htmlFor="playground-switch">Enable feature</label>
            </div>
        );
    },
    play: async ({ canvasElement }) => {
        const toggle = within(canvasElement).getByRole('switch', { name: 'Enable feature' });
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await userEvent.click(toggle);
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
    },
};
