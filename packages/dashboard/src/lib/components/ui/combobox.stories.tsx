import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxValue,
} from './combobox.js';

const frameworks = ['React', 'Vue', 'Svelte', 'Angular'];

const meta = {
    title: 'UI/Combobox',
    component: ComboboxInput,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    argTypes: {
        showTrigger: {
            control: 'boolean',
            description: 'Shows the icon-only popup trigger.',
        },
        showClear: {
            control: 'boolean',
            description: 'Shows a clear action after a value has been selected.',
        },
        triggerLabel: {
            control: 'text',
            description: 'Accessible name for the popup trigger.',
        },
        clearLabel: {
            control: 'text',
            description: 'Accessible name for the clear action.',
        },
        disabled: {
            control: 'boolean',
            description: 'Disables the input and its inline actions.',
        },
    },
} satisfies Meta<typeof ComboboxInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FrameworkPicker: Story = {
    args: {
        placeholder: 'Select a framework',
        showTrigger: true,
        showClear: true,
        triggerLabel: 'Open framework options',
        clearLabel: 'Clear framework selection',
    },
    render: args => (
        <div className="w-[300px] space-y-2">
            <label className="text-sm font-medium" htmlFor="framework-combobox">
                Framework
            </label>
            <Combobox items={frameworks}>
                <ComboboxInput {...args} id="framework-combobox" />
                <ComboboxContent>
                    <ComboboxEmpty>No frameworks found.</ComboboxEmpty>
                    <ComboboxList>
                        {frameworks.map(framework => (
                            <ComboboxItem key={framework} value={framework}>
                                {framework}
                            </ComboboxItem>
                        ))}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const page = within(canvasElement.ownerDocument.body);
        const input = canvas.getByRole('combobox', { name: 'Framework' });

        await userEvent.click(canvas.getByRole('button', { name: 'Open framework options' }));
        await userEvent.click(await page.findByRole('option', { name: 'React' }));
        await expect(input).toHaveValue('React');

        await userEvent.click(canvas.getByRole('button', { name: 'Clear framework selection' }));
        await expect(input).toHaveValue('');
    },
};

export const MultipleWithRemovableChips: Story = {
    render: () => (
        <div className="w-[360px] space-y-2">
            <label className="text-sm font-medium" htmlFor="framework-chips-input">
                Frameworks
            </label>
            <Combobox items={frameworks} multiple defaultValue={['React', 'Vue']}>
                <ComboboxChips>
                    <ComboboxValue>
                        {(selectedFrameworks: string[]) => (
                            <>
                                {selectedFrameworks.map(framework => (
                                    <ComboboxChip
                                        key={framework}
                                        aria-label={framework}
                                        removeLabel={`Remove ${framework}`}
                                    >
                                        {framework}
                                    </ComboboxChip>
                                ))}
                                <ComboboxChipsInput id="framework-chips-input" />
                            </>
                        )}
                    </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent>
                    <ComboboxEmpty>No frameworks found.</ComboboxEmpty>
                    <ComboboxList>
                        {frameworks.map(framework => (
                            <ComboboxItem key={framework} value={framework}>
                                {framework}
                            </ComboboxItem>
                        ))}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const removeReact = canvas.getByRole('button', { name: 'Remove React' });
        await userEvent.click(removeReact);
        await expect(canvas.queryByRole('button', { name: 'Remove React' })).not.toBeInTheDocument();
        await expect(canvas.getByRole('button', { name: 'Remove Vue' })).toBeVisible();
    },
};
