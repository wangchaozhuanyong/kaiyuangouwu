import { Button } from '@/vdb/components/ui/button.js';
import { cn } from '@/vdb/lib/utils.js';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Trans } from '@lingui/react/macro';
import {
    DialogContent as DialogContentBase,
    DialogTitle as DialogTitleBase,
} from '@vendure-io/ui/components/ui/dialog';
import { XIcon } from 'lucide-react';

export {
    Dialog,
    DialogClose,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTrigger,
} from '@vendure-io/ui/components/ui/dialog';

export function DialogContent({
    children,
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof DialogContentBase>) {
    return (
        <DialogContentBase showCloseButton={false} {...props}>
            {children}
            {showCloseButton && (
                <DialogPrimitive.Close
                    data-slot="dialog-close"
                    render={<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />}
                >
                    <XIcon />
                    <span className="sr-only">
                        <Trans>Close</Trans>
                    </span>
                </DialogPrimitive.Close>
            )}
        </DialogContentBase>
    );
}

// Override DialogTitle to use the heading font (Public Sans). Wrap the base
// wrapper rather than the primitive — going through the primitive directly
// can resolve to a different module instance, leaving the title outside the
// Dialog root context ("Cannot destructure property 'store' of
// useDialogRootContext(...)").
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogTitleBase>) {
    return <DialogTitleBase className={cn('font-heading', className)} {...props} />;
}
