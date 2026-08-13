import { Button } from '@/vdb/components/ui/button.js';
import { AlertEntry } from '@/vdb/hooks/use-alerts.js';
import { cn } from '@/vdb/lib/utils.js';
import type { MessageDescriptor } from '@lingui/core';
import { useLingui } from '@lingui/react/macro';
import { ComponentProps } from 'react';

interface AlertItemProps extends ComponentProps<'div'> {
    alert: AlertEntry;
}

export function AlertItem({ alert, className, ...props }: Readonly<AlertItemProps>) {
    const { i18n } = useLingui();
    if (!alert.active) {
        return null;
    }
    const { definition: def } = alert;
    const translate = (value: string | MessageDescriptor | undefined) =>
        typeof value === 'string' || value == null ? value : i18n._(value);
    const title = typeof def.title === 'function' ? def.title(alert.lastData) : def.title;
    const description =
        typeof def.description === 'function' ? def.description(alert.lastData) : def.description;

    return (
        <div className={cn('flex items-center justify-between gap-1', className)} {...props}>
            <div className="flex flex-col">
                <span className="text-sm">{translate(title)}</span>
                <span className="text-xs text-muted-foreground">{translate(description)}</span>
            </div>
            <div className="flex items-center gap-1">
                {def.actions?.map((action, index) => {
                    if (action.component) {
                        const ActionComponent = action.component;
                        return (
                            <ActionComponent
                                key={
                                    typeof action.label === 'string'
                                        ? action.label
                                        : (action.label?.id ?? index)
                                }
                                data={alert.lastData}
                                dismiss={() => alert.dismiss()}
                            />
                        );
                    }
                    return (
                        <Button
                            key={typeof action.label === 'string' ? action.label : action.label.id}
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                                await action.onClick?.({
                                    data: alert.lastData,
                                    dismiss: () => alert.dismiss(),
                                });
                            }}
                        >
                            {translate(action.label)}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}
