import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { expect, userEvent, within } from 'storybook/test';
import { withDescription } from '../../../.storybook/with-description.js';
import { MoneyInput } from './money-input.js';

const meta = {
    title: 'Form Inputs/MoneyInput',
    component: MoneyInput,
    ...withDescription(import.meta.url, './money-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'number',
            description: 'The current value in minor units (e.g., cents)',
        },
        currency: {
            control: 'select',
            options: ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'],
            description: 'The currency code',
        },
    },
} satisfies Meta<typeof MoneyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 9999,
        currency: 'USD',
    },
    render: args => {
        const [value, setValue] = useState(args.value);
        return (
            <div className="w-[300px] space-y-2">
                <label htmlFor="playground-money" className="text-sm font-medium">
                    Price
                </label>
                <MoneyInput
                    {...args}
                    id="playground-money"
                    name="playground"
                    value={value}
                    onChange={setValue}
                    onBlur={() => undefined}
                    ref={() => undefined}
                />
            </div>
        );
    },
    play: async ({ canvasElement }) => {
        const input = within(canvasElement).getByRole('textbox', { name: 'Price' });
        await expect(input).toHaveAttribute('name', 'playground');
        await userEvent.clear(input);
        await userEvent.type(input, '12.34');
        await expect(input).toHaveValue('12.34');
    },
};

export const DifferentCurrencies: Story = {
    args: {
        value: 9999,
    },
    render: (args: any) => {
        const { register } = useForm();
        return (
            <div className="w-[300px] space-y-4">
                <div className="space-y-2">
                    <label htmlFor="money-usd" className="text-sm font-medium">USD</label>
                    <MoneyInput {...register('usd')} id="money-usd" currency="USD" value={args.value} />
                </div>

                <div className="space-y-2">
                    <label htmlFor="money-eur" className="text-sm font-medium">EUR</label>
                    <MoneyInput {...register('eur')} id="money-eur" currency="EUR" value={args.value} />
                </div>

                <div className="space-y-2">
                    <label htmlFor="money-gbp" className="text-sm font-medium">GBP</label>
                    <MoneyInput {...register('gbp')} id="money-gbp" currency="GBP" value={args.value} />
                </div>

                <div className="space-y-2">
                    <label htmlFor="money-jpy" className="text-sm font-medium">JPY</label>
                    <MoneyInput {...register('jpy')} id="money-jpy" currency="JPY" value={args.value} />
                </div>
            </div>
        );
    },
};

export const LargeAmount: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('large');
        return (
            <div className="w-[300px] space-y-2">
                <label htmlFor="large-money" className="text-sm font-medium">
                    Large amount
                </label>
                <MoneyInput {...field} id="large-money" currency="USD" value={123} />
            </div>
        );
    },
};
