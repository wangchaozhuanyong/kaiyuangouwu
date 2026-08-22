import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search, X } from 'lucide-react';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText,
} from './input-group.js';

const meta = {
    title: 'UI/Input Group',
    component: InputGroup,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    argTypes: {
        className: {
            control: 'text',
            description: 'Additional classes applied to the input group container.',
        },
    },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchField: Story = {
    render: () => (
        <div className="w-[360px] space-y-2">
            <label htmlFor="catalog-search" className="text-sm font-medium">
                Search catalog
            </label>
            <InputGroup>
                <InputGroupAddon align="inline-start">
                    <Search aria-hidden="true" />
                    <InputGroupText>Products</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput id="catalog-search" placeholder="Search by name or SKU" />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="Clear search">
                        <X />
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
        </div>
    ),
};
