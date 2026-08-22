import type { Meta, StoryObj } from '@storybook/react-vite';
import { DirectionProvider, useDirection } from './direction.js';

function DirectionPreview() {
    const direction = useDirection();
    return (
        <div dir={direction} className="w-[320px] rounded-md border p-4 text-sm">
            <p className="font-medium">Current direction: {direction}</p>
            <p className="text-muted-foreground">This content follows the provider reading direction.</p>
        </div>
    );
}

const meta = {
    title: 'UI/Direction',
    component: DirectionProvider,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof DirectionProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RightToLeft: Story = {
    render: () => (
        <DirectionProvider direction="rtl">
            <DirectionPreview />
        </DirectionProvider>
    ),
};
