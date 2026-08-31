import { Button, Input, Label } from '@vendure/dashboard';
import { ClipboardPaste, Copy, Plus, Search, Trash2 } from 'lucide-react';

import { TwoFactorText } from './messages';
import { formatTotpCode } from './totp';

export function QuickQueryCard({
    text,
    input,
    code,
    secondsRemaining,
    querying,
    onInputChange,
    onPaste,
    onQuery,
    onCopy,
    onClear,
    onSave,
    saveDisabled,
}: {
    text: TwoFactorText;
    input: string;
    code: string | null;
    secondsRemaining: number;
    querying: boolean;
    onInputChange: (value: string) => void;
    onPaste: () => void;
    onQuery: () => void;
    onCopy: () => void;
    onClear: () => void;
    onSave: () => void;
    saveDisabled?: boolean;
}) {
    return (
        <section aria-labelledby="two-factor-quick-query-title">
            <h2 id="two-factor-quick-query-title" className="font-heading text-lg font-semibold">
                {text.quickQuery}
            </h2>
            <form
                className="mt-4 space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    onQuery();
                }}
            >
                <div className="space-y-2">
                    <Label htmlFor="two-factor-quick-secret">{text.secret}</Label>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <Input
                            id="two-factor-quick-secret"
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={input}
                            placeholder={text.secretPlaceholder}
                            onChange={event => onInputChange(event.target.value)}
                        />
                        <Button type="button" variant="outline" onClick={onPaste}>
                            <ClipboardPaste className="size-4" aria-hidden="true" />
                            {text.paste}
                        </Button>
                        <Button type="submit" disabled={!input.trim() || querying}>
                            <Search className="size-4" aria-hidden="true" />
                            {text.query}
                        </Button>
                    </div>
                </div>

                {code ? (
                    <div className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <p className="text-xs text-muted-foreground">{text.currentCode}</p>
                                <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.12em] sm:text-4xl">
                                    {formatTotpCode(code)}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" onClick={onCopy}>
                                    <Copy className="size-4" aria-hidden="true" />
                                    {text.copy}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={saveDisabled}
                                    onClick={onSave}
                                >
                                    <Plus className="size-4" aria-hidden="true" />
                                    {text.saveToList}
                                </Button>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                            <span className="min-w-12 font-mono text-sm">
                                {secondsRemaining} {text.seconds}
                            </span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                                    style={{ width: `${(secondsRemaining / 30) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{text.queryMemoryNotice}</span>
                    {(input || code) && (
                        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                            <Trash2 className="size-4" aria-hidden="true" />
                            {text.clear}
                        </Button>
                    )}
                </div>
            </form>
        </section>
    );
}
