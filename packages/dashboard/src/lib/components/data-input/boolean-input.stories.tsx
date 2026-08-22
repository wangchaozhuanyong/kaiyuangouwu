import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { BooleanInput } from './boolean-input.js';

const meta = {
    title: 'Form Inputs/BooleanInput',
    component: BooleanInput,
    ...withDescription(import.meta.url, './boolean-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'boolean',
            description: 'Whether the switch is on',
        },
    },
} satisfies Meta<typeof BooleanInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('playground');
        return (
            <div className="flex items-center gap-2">
                <BooleanInput {...field} {...args} id="enable-notifications" />
                <label htmlFor="enable-notifications" className="text-sm font-medium">
                    Enable notifications
                </label>
            </div>
        );
    },
};

export const ProductSettings: Story = {
    render: () => {
        const { register } = useForm();
        return (
            <div className="w-[350px] space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <label htmlFor="product-enabled" className="text-sm font-medium">
                            Product enabled
                        </label>
                        <p className="text-xs text-muted-foreground">
                            Make this product visible in the catalog
                        </p>
                    </div>
                    <BooleanInput {...register('enabled')} id="product-enabled" />
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <label htmlFor="featured" className="text-sm font-medium">
                            Featured
                        </label>
                        <p className="text-xs text-muted-foreground">Show on homepage</p>
                    </div>
                    <BooleanInput {...register('featured')} id="featured" />
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <label htmlFor="track-inventory" className="text-sm font-medium">
                            Track inventory
                        </label>
                        <p className="text-xs text-muted-foreground">Monitor stock levels</p>
                    </div>
                    <BooleanInput {...register('trackInventory')} id="track-inventory" />
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <label htmlFor="allow-backorder" className="text-sm font-medium">
                            Allow backorder
                        </label>
                        <p className="text-xs text-muted-foreground">Accept orders when out of stock</p>
                    </div>
                    <BooleanInput {...register('allowBackorder')} id="allow-backorder" />
                </div>
            </div>
        );
    },
};

export const StringValues: Story = {
    render: () => {
        const { register } = useForm();
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <BooleanInput {...register('trueValue')} id="true-value" />
                    <label htmlFor="true-value" className="text-sm font-medium">
                        String value: "true"
                    </label>
                </div>

                <div className="flex items-center gap-2">
                    <BooleanInput {...register('falseValue')} id="false-value" />
                    <label htmlFor="false-value" className="text-sm font-medium">
                        String value: "false"
                    </label>
                </div>

                <div className="text-sm text-muted-foreground">
                    Demonstrates handling of string "true"/"false" values
                </div>
            </div>
        );
    },
};
