import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from './avatar.js';

const meta = {
    title: 'UI/Avatar',
    component: Avatar,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    argTypes: {
        size: {
            control: 'select',
            options: ['sm', 'default', 'lg'],
            description: 'Controls the avatar dimensions.',
        },
    },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SizesAndGroup: Story = {
    render: () => (
        <AvatarGroup role="group" aria-label="Store team">
            <Avatar size="sm">
                <AvatarFallback>SM</AvatarFallback>
            </Avatar>
            <Avatar>
                <AvatarFallback>JD</AvatarFallback>
                <AvatarBadge role="status" aria-label="Online" />
            </Avatar>
            <Avatar size="lg">
                <AvatarFallback>AL</AvatarFallback>
            </Avatar>
            <AvatarGroupCount role="img" aria-label="3 more team members">
                +3
            </AvatarGroupCount>
        </AvatarGroup>
    ),
};
