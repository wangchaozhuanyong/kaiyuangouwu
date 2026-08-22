import type { Meta, StoryObj } from '@storybook/react-vite';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from './native-select.js';

const meta = {
    title: 'UI/Native Select',
    component: NativeSelect,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    argTypes: {
        disabled: {
            control: 'boolean',
            description: 'Disables the native select control.',
        },
        size: {
            control: 'inline-radio',
            options: ['sm', 'default'],
            description: 'Controls the native select height.',
        },
        name: {
            control: 'text',
            description: 'Name submitted with the selected value.',
        },
    },
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Channel: Story = {
    render: () => (
        <div className="w-[280px] space-y-2">
            <label htmlFor="channel-select" className="text-sm font-medium">
                Sales channel
            </label>
            <NativeSelect id="channel-select" className="w-full" defaultValue="web">
                <NativeSelectOptGroup label="Online">
                    <NativeSelectOption value="web">Web store</NativeSelectOption>
                    <NativeSelectOption value="marketplace">Marketplace</NativeSelectOption>
                </NativeSelectOptGroup>
                <NativeSelectOptGroup label="Retail">
                    <NativeSelectOption value="store">Flagship store</NativeSelectOption>
                </NativeSelectOptGroup>
            </NativeSelect>
        </div>
    ),
};
