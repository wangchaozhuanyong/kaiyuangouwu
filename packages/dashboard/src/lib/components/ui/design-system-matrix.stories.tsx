import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from './button.js';
import { Field, FieldDescription, FieldError, FieldLabel } from './field.js';
import { Input } from './input.js';
import { Spinner } from './spinner.js';
import { Switch } from './switch.js';

function QualityMatrix() {
    return (
        <main className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:grid-cols-2" data-testid="quality-matrix">
            <section className="space-y-3 rounded-md border bg-card p-4 text-card-foreground">
                <h2 className="font-heading text-base font-semibold">Actions</h2>
                <div className="flex flex-wrap gap-2">
                    <Button>Save changes</Button>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Delete</Button>
                    <Button variant="link">View documentation</Button>
                </div>
            </section>

            <section className="space-y-4 rounded-md border bg-card p-4 text-card-foreground">
                <h2 className="font-heading text-base font-semibold">Form states</h2>
                <Field>
                    <FieldLabel htmlFor="matrix-email">Email address</FieldLabel>
                    <Input
                        id="matrix-email"
                        type="email"
                        defaultValue="invalid-email"
                        aria-invalid="true"
                        aria-describedby="matrix-email-description matrix-email-error"
                    />
                    <FieldDescription id="matrix-email-description">
                        Used for order notifications.
                    </FieldDescription>
                    <FieldError id="matrix-email-error">Enter a valid email address.</FieldError>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                    <Switch />
                    Publish automatically
                </label>
                <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Spinner aria-hidden="true" />
                    Loading store data
                </div>
            </section>
        </main>
    );
}

const meta = {
    title: 'Introduction/Quality Matrix',
    component: QualityMatrix,
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof QualityMatrix>;

export default meta;
type Story = StoryObj<typeof meta>;

async function assertCoreSemantics(canvasElement: HTMLElement) {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Email address' })).toHaveAttribute(
        'aria-invalid',
        'true',
    );
    await expect(canvas.getByRole('switch', { name: 'Publish automatically' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading store data');
}

export const LightLtrDesktop: Story = {
    play: async ({ canvasElement }) => assertCoreSemantics(canvasElement),
};

export const DarkLtrDesktop: Story = {
    globals: { theme: 'dark' },
    play: async ({ canvasElement }) => {
        await assertCoreSemantics(canvasElement);
        await expect(canvasElement.ownerDocument.documentElement).toHaveClass('dark');
    },
};

export const LightRtlDesktop: Story = {
    globals: { direction: 'rtl' },
    play: async ({ canvasElement }) => {
        await assertCoreSemantics(canvasElement);
        await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute('dir', 'rtl');
    },
};

export const DarkRtlDesktop: Story = {
    globals: { theme: 'dark', direction: 'rtl' },
    play: async ({ canvasElement }) => {
        await assertCoreSemantics(canvasElement);
        await expect(canvasElement.ownerDocument.documentElement).toHaveClass('dark');
        await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute('dir', 'rtl');
    },
};

export const Mobile375: Story = {
    globals: { viewport: { value: '375-812', isRotated: false } },
    play: async ({ canvasElement }) => {
        await assertCoreSemantics(canvasElement);
        const matrix = within(canvasElement).getByTestId('quality-matrix');
        await expect(matrix.scrollWidth).toBeLessThanOrEqual(matrix.clientWidth);
    },
};

export const Tablet768: Story = {
    globals: { viewport: { value: '768-1024', isRotated: false } },
    play: async ({ canvasElement }) => assertCoreSemantics(canvasElement),
};

export const DesktopAtTwoHundredPercent: Story = {
    globals: { viewport: { value: '720-450', isRotated: false } },
    play: async ({ canvasElement }) => assertCoreSemantics(canvasElement),
};
