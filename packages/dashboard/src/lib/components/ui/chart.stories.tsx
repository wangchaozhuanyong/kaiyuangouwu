import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from './chart.js';

const data = [
    { month: 'Jan', orders: 186 },
    { month: 'Feb', orders: 305 },
    { month: 'Mar', orders: 237 },
    { month: 'Apr', orders: 273 },
];

const chartConfig = {
    orders: {
        label: 'Orders',
        color: 'var(--chart-1)',
    },
} satisfies ChartConfig;

const meta = {
    title: 'UI/Chart',
    component: ChartContainer,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof ChartContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Orders: Story = {
    render: () => (
        <ChartContainer
            config={chartConfig}
            className="h-[260px] w-[480px]"
            role="img"
            aria-label="Monthly order volume from January to April"
        >
            <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} tickMargin={10} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" fill="var(--color-orders)" radius={4} />
            </BarChart>
        </ChartContainer>
    ),
};
