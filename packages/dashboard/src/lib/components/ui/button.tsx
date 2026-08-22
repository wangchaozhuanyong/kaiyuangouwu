import { cn } from '@/vdb/lib/utils.js';
import { Button as BaseButton } from '@vendure-io/ui/components/ui/button';
import { type ComponentProps } from 'react';

/** Auto-sets nativeButton={false} when render is provided to suppress Base UI warnings. */
function Button({ render, nativeButton, className, variant, ...props }: ComponentProps<typeof BaseButton>) {
    return (
        <BaseButton
            render={render}
            nativeButton={render ? (nativeButton ?? false) : nativeButton}
            variant={variant}
            className={cn(variant === 'link' && 'text-link hover:text-link/80', className)}
            {...props}
        />
    );
}

export { buttonVariants } from '@vendure-io/ui/components/ui/button';
export { Button };
