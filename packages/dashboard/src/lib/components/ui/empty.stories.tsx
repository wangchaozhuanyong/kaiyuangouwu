import type { Meta, StoryObj } from '@storybook/react-vite';
import { PackageOpen } from 'lucide-react';
import { Button } from './button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './empty.js';

const meta = {
    title: 'UI/Empty',
    component: Empty,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoProducts: Story = {
    render: () => (
        <Empty className="w-[440px] border">
            <EmptyHeader>
                <EmptyMedia variant="icon" aria-hidden="true">
                    <PackageOpen />
                </EmptyMedia>
                <EmptyTitle>No products yet</EmptyTitle>
                <EmptyDescription>Create your first product to start building the catalog.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button>Create product</Button>
            </EmptyContent>
        </Empty>
    ),
};
