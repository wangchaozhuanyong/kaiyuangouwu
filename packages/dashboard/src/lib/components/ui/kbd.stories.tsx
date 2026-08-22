import type { Meta, StoryObj } from '@storybook/react-vite';
import { Kbd, KbdGroup } from './kbd.js';

const meta = {
    title: 'UI/Keyboard Key',
    component: Kbd,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shortcut: Story = {
    render: () => (
        <p className="flex items-center gap-2 text-sm">
            Open command menu
            <KbdGroup aria-label="Command K">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
            </KbdGroup>
        </p>
    ),
};
