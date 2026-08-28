import { Button, Label } from '@vendure/dashboard';
import { Image as ImageIcon, ImagePlus, X } from 'lucide-react';
import { ReactNode } from 'react';

export function EditorField({
    label,
    hint,
    meta,
    htmlFor,
    className,
    compact = false,
    children,
}: Readonly<{
    label: string;
    hint?: string;
    meta?: ReactNode;
    htmlFor?: string;
    className?: string;
    compact?: boolean;
    children: ReactNode;
}>) {
    return (
        <div className={`min-w-0 ${compact ? 'space-y-1' : 'space-y-2'} ${className ?? ''}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
                <Label
                    className={compact ? 'block truncate text-xs text-muted-foreground' : undefined}
                    htmlFor={htmlFor}
                    title={compact ? label : undefined}
                >
                    {label}
                </Label>
                {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
            </div>
            {children}
            {hint ? (
                <p className={`${compact ? 'leading-4' : 'leading-5'} text-xs text-muted-foreground`}>
                    {hint}
                </p>
            ) : null}
        </div>
    );
}

export function CompactAssetControl({
    preview,
    alt,
    fileName,
    selectLabel,
    removeLabel,
    previewClassName = 'size-9',
    imageFit = 'cover',
    onSelect,
    onRemove,
}: Readonly<{
    preview: string | null | undefined;
    alt: string;
    fileName?: string | null;
    selectLabel: string;
    removeLabel: string;
    previewClassName?: string;
    imageFit?: 'cover' | 'contain';
    onSelect: () => void;
    onRemove: () => void;
}>) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            {preview ? (
                <img
                    className={`${previewClassName} shrink-0 rounded-md border ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
                    src={preview}
                    alt={alt}
                />
            ) : (
                <div
                    className={`${previewClassName} flex shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/40`}
                    aria-hidden="true"
                >
                    <ImageIcon className="size-4 text-muted-foreground" />
                </div>
            )}
            <Button
                className="h-9 min-w-0 flex-1 justify-start px-2.5"
                type="button"
                size="sm"
                variant="outline"
                title={fileName ?? undefined}
                onClick={onSelect}
            >
                <ImagePlus className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{fileName ?? selectLabel}</span>
            </Button>
            {preview ? (
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={removeLabel}
                    title={removeLabel}
                    onClick={onRemove}
                >
                    <X className="size-4" aria-hidden="true" />
                </Button>
            ) : null}
        </div>
    );
}
