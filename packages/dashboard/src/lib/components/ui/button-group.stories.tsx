import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { ButtonGroup, ButtonGroupText } from './button-group.js';

const meta = {
    title: 'UI/Button Group',
    component: ButtonGroup,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    argTypes: {
        orientation: {
            control: 'inline-radio',
            options: ['horizontal', 'vertical'],
            description: 'Sets the visual and semantic grouping direction.',
        },
    },
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
    render: () => (
        <ButtonGroup aria-label="Order actions">
            <Button variant="outline">Cancel</Button>
            <ButtonGroupText>Draft</ButtonGroupText>
            <Button>Publish</Button>
        </ButtonGroup>
    ),
};

export const Vertical: Story = {
    render: () => (
        <ButtonGroup orientation="vertical" aria-label="View options">
            <Button variant="outline">Summary</Button>
            <Button variant="outline">Details</Button>
            <Button variant="outline">History</Button>
        </ButtonGroup>
    ),
};
