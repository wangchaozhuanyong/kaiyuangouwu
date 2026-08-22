import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { Button } from './button.js';
import { Form } from './form.js';
import { Input } from './input.js';
import { Label } from './label.js';

type ProfileForm = {
    displayName: string;
};

function ProfileFormExample() {
    const form = useForm<ProfileForm>({ defaultValues: { displayName: 'Vendure Store' } });

    return (
        <Form {...form}>
            <form className="w-[340px] space-y-4" onSubmit={form.handleSubmit(() => undefined)}>
                <div className="space-y-2">
                    <Label htmlFor="display-name">Display name</Label>
                    <Input id="display-name" {...form.register('displayName', { required: true })} />
                </div>
                <Button type="submit">Save profile</Button>
            </form>
        </Form>
    );
}

const meta = {
    title: 'UI/Form',
    component: Form,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Profile: Story = {
    render: () => <ProfileFormExample />,
};
