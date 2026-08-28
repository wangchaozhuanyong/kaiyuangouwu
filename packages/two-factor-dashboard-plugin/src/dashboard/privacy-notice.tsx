import { Badge, Button } from '@vendure/dashboard';
import { CheckCircle2, ChevronDown, ChevronUp, DatabaseZap, LockKeyhole } from 'lucide-react';
import { useState } from 'react';

import { TwoFactorText } from './messages';

export function PrivacyNotice({ text }: { text: TwoFactorText }) {
    const [mobileExpanded, setMobileExpanded] = useState(true);
    const details = [
        text.privacyNoDatabase,
        text.privacyNoUpload,
        text.privacyLocalGeneration,
        text.privacyRefresh,
        text.privacyClear,
    ];

    return (
        <section aria-labelledby="two-factor-privacy-title">
            <div className="hidden items-center gap-2 md:flex">
                <DatabaseZap className="size-5" aria-hidden="true" />
                <h2 id="two-factor-privacy-title" className="font-heading text-lg font-semibold">
                    {text.privacyTitle}
                </h2>
            </div>
            <Button
                type="button"
                variant="outline"
                className="flex h-auto w-full items-center justify-between gap-3 px-3 py-2.5 md:hidden"
                aria-expanded={mobileExpanded}
                aria-controls="two-factor-privacy-details"
                onClick={() => setMobileExpanded(value => !value)}
            >
                <span className="flex items-center gap-2 font-heading font-semibold">
                    <DatabaseZap className="size-5" aria-hidden="true" />
                    {text.privacyTitle}
                </span>
                <span className="flex items-center gap-1 text-primary">
                    {mobileExpanded ? text.collapsePrivacy : text.expandPrivacy}
                    {mobileExpanded ? (
                        <ChevronUp className="size-4" aria-hidden="true" />
                    ) : (
                        <ChevronDown className="size-4" aria-hidden="true" />
                    )}
                </span>
            </Button>

            {!mobileExpanded && (
                <p className="mt-3 rounded-md bg-primary/5 px-3 py-2 text-sm text-primary md:hidden">
                    {text.privacySummary}
                </p>
            )}

            <div
                id="two-factor-privacy-details"
                className={`${mobileExpanded ? 'block' : 'hidden'} mt-4 space-y-4 md:block`}
            >
                <div className="rounded-md bg-primary/5 px-3 py-2 text-sm font-medium text-primary">
                    {text.privacyStorage}
                </div>
                <ul className="space-y-3 text-sm">
                    {details.map(item => (
                        <li key={item} className="flex items-start gap-2">
                            <CheckCircle2
                                className="mt-0.5 size-4 shrink-0 text-primary"
                                aria-hidden="true"
                            />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
                <div className="border-t pt-3">
                    <Badge variant="outline" className="whitespace-normal text-left leading-5">
                        <LockKeyhole className="size-3.5" aria-hidden="true" />
                        {text.privacyLimit}
                    </Badge>
                    <p className="mt-2 text-xs text-muted-foreground">{text.privacyPublicDevice}</p>
                </div>
            </div>
        </section>
    );
}
