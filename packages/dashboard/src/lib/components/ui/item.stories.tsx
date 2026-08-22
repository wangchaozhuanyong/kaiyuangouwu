import type { Meta, StoryObj } from '@storybook/react-vite';
import { Package } from 'lucide-react';
import { Button } from './button.js';
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemMedia,
    ItemTitle,
} from './item.js';

const meta = {
    title: 'UI/Item',
    component: Item,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof Item>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProductList: Story = {
    render: () => (
        <ItemGroup aria-label="Products" className="w-[480px]">
            <Item role="listitem" variant="outline">
                <ItemMedia variant="icon" aria-hidden="true">
                    <Package />
                </ItemMedia>
                <ItemContent>
                    <ItemTitle>Wireless headphones</ItemTitle>
                    <ItemDescription>SKU WH-100 · In stock</ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Button variant="outline" size="sm">
                        Edit
                    </Button>
                </ItemActions>
            </Item>
        </ItemGroup>
    ),
};
