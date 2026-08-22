import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spinner } from './spinner.js';

const meta = {
    title: 'UI/Spinner',
    component: Spinner,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
    render: () => (
        <div className="flex items-center gap-4" aria-label="Loading examples">
            <Spinner className="size-4" />
            <Spinner className="size-6" />
            <Spinner className="size-8" />
        </div>
    ),
};
