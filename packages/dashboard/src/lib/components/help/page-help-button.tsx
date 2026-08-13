import { Button } from '@/vdb/components/ui/button.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/vdb/components/ui/sheet.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { AlertTriangle, CircleHelp, Lightbulb, ListChecks } from 'lucide-react';
import { getPageHelpMode, getPageHelpTopic, localizeHelpText } from './help-content.js';

export function PageHelpButton({ pageId }: Readonly<{ pageId?: string }>) {
    const { t } = useLingui();
    const { displayLanguage } = useUserSettings().settings;
    const topic = getPageHelpTopic(pageId);

    if (!topic) return null;

    const label = t`View operation guide`;
    const mode = getPageHelpMode(pageId);
    const helpId = pageId ?? 'page';
    const steps =
        mode === 'list' ? (topic.listSteps ?? topic.detailSteps) : (topic.detailSteps ?? topic.listSteps);

    return (
        <Sheet>
            <SheetTrigger
                render={
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="shrink-0"
                        aria-label={label}
                        title={label}
                    />
                }
            >
                <CircleHelp className="size-4" />
            </SheetTrigger>
            <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg">
                <SheetHeader className="border-b px-6 py-5 text-left">
                    <p className="text-xs font-medium text-muted-foreground">
                        {mode === 'list' ? (
                            <Trans>List and bulk actions</Trans>
                        ) : (
                            <Trans>Details and configuration</Trans>
                        )}
                    </p>
                    <SheetTitle>{localizeHelpText(topic.title, displayLanguage)}</SheetTitle>
                    <SheetDescription className="text-sm leading-6">
                        {localizeHelpText(topic.purpose, displayLanguage)}
                    </SheetDescription>
                </SheetHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-8 px-6 py-6">
                        {steps?.length ? (
                            <section aria-labelledby={`help-steps-${helpId}`}>
                                <div className="mb-4 flex items-center gap-2">
                                    <ListChecks className="size-4 text-primary" />
                                    <h3 id={`help-steps-${helpId}`} className="text-sm font-semibold">
                                        <Trans>Recommended workflow</Trans>
                                    </h3>
                                </div>
                                <ol className="space-y-4">
                                    {steps.map((step, index) => (
                                        <li key={step.zh_Hans} className="flex gap-3 text-sm leading-6">
                                            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted font-mono text-xs tabular-nums">
                                                {index + 1}
                                            </span>
                                            <span>{localizeHelpText(step, displayLanguage)}</span>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        ) : null}
                        <section aria-labelledby={`help-tips-${helpId}`}>
                            <div className="mb-4 flex items-center gap-2">
                                <Lightbulb className="size-4 text-primary" />
                                <h3 id={`help-tips-${helpId}`} className="text-sm font-semibold">
                                    <Trans>Practical tips</Trans>
                                </h3>
                            </div>
                            <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                                {topic.tips.map(tip => (
                                    <li key={tip.zh_Hans} className="border-s-2 border-border ps-3">
                                        {localizeHelpText(tip, displayLanguage)}
                                    </li>
                                ))}
                            </ul>
                        </section>
                        {topic.warning ? (
                            <section className="border-s-2 border-amber-500 bg-amber-500/5 px-4 py-3">
                                <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="size-4" />
                                    <h3 className="text-sm font-semibold">
                                        <Trans>Confirm before continuing</Trans>
                                    </h3>
                                </div>
                                <p className="text-sm leading-6 text-muted-foreground">
                                    {localizeHelpText(topic.warning, displayLanguage)}
                                </p>
                            </section>
                        ) : null}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
