import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { toast, Toaster } from './sonner.js';

const meta = {
    title: 'UI/Sonner',
    component: Toaster,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Notification: Story = {
    render: () => (
        <>
            <Button
                onClick={() =>
                    toast.success('Product published', {
                        description: 'The product is now visible in the web store.',
                    })
                }
            >
                Show notification
            </Button>
            <Toaster />
        </>
    ),
};
