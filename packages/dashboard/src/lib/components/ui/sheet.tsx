import { Button } from '@/vdb/components/ui/button.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import {
    SheetContent as OriginalSheetContent,
    Sheet,
    SheetClose,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@vendure-io/ui/components/ui/sheet';
import { XIcon } from 'lucide-react';

/**
 * Wrapper around the upstream SheetContent that overrides the max-width
 * from `sm:max-w-sm` (384px) to `sm:max-w-lg` (512px) so that panels
 * have enough room for tables, badges, and other content.
 */
function SheetContent({
    className,
    children,
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof OriginalSheetContent>) {
    return (
        <OriginalSheetContent
            showCloseButton={false}
            className={cn('data-[side=left]:sm:max-w-lg data-[side=right]:sm:max-w-lg', className)}
            {...props}
        >
            {children}
            {showCloseButton && (
                <SheetClose
                    render={<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />}
                >
                    <XIcon />
                    <span className="sr-only">
                        <Trans>Close</Trans>
                    </span>
                </SheetClose>
            )}
        </OriginalSheetContent>
    );
}

export {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
};
