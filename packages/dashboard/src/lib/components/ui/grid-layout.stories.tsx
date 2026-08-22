import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card.js';
import { GridLayout, type GridLayout as GridLayoutValue } from './grid-layout.js';

const initialLayouts: GridLayoutValue[] = [
    { i: 'orders', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 1 },
    { i: 'revenue', x: 6, y: 0, w: 6, h: 2, minW: 3, minH: 1 },
];

function GridLayoutExample() {
    const [layouts, setLayouts] = useState(initialLayouts);
    return (
        <GridLayout
            className="w-[720px]"
            layouts={layouts}
            onLayoutChange={setLayouts}
            isDraggable
            isResizable
            rowHeight={80}
        >
            <Card key="orders" className="h-full">
                <CardHeader>
                    <CardTitle>Orders</CardTitle>
                </CardHeader>
                <CardContent>1,284 this month</CardContent>
            </Card>
            <Card key="revenue" className="h-full">
                <CardHeader>
                    <CardTitle>Revenue</CardTitle>
                </CardHeader>
                <CardContent>$42,680 this month</CardContent>
            </Card>
        </GridLayout>
    );
}

const meta = {
    title: 'UI/Grid Layout',
    component: GridLayout,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof GridLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DashboardWidgets: Story = {
    render: () => <GridLayoutExample />,
};
