import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/vdb/components/ui/alert-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { cn } from '@/vdb/lib/utils.js';
import { getTypeForState, type StateType } from '@/vdb/utils/state-type.js';
import { Trans } from '@lingui/react/macro';
import { CircleAlert, CircleCheck, CircleDashed, CircleX, EllipsisVertical } from 'lucide-react';
import { useState } from 'react';

export { getTypeForState, type StateType } from '@/vdb/utils/state-type.js';

export type StateTransitionAction = {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    type?: StateType;
    confirmation?: {
        title: string;
        description: string;
        confirmText?: string;
    };
};

type StateTransitionControlProps = {
    currentState: string;
    statesTranslationFunction: (state: string) => string;
    actions: StateTransitionAction[];
    isLoading?: boolean;
};

export function StateTransitionControl({
    currentState,
    statesTranslationFunction,
    actions,
    isLoading,
}: Readonly<StateTransitionControlProps>) {
    const [pendingAction, setPendingAction] = useState<StateTransitionAction | null>(null);
    const currentStateType = getTypeForState(currentState);
    const iconForType = {
        destructive: <CircleX className="h-4 w-4 text-destructive" />,
        success: <CircleCheck className="h-4 w-4 text-success-text" />,
        warning: <CircleAlert className="h-4 w-4 text-warning-text" />,
        default: <CircleDashed className="h-4 w-4 text-muted-foreground" />,
    };

    return (
        <div className="flex min-w-0">
            <div
                className={cn(
                    'inline-flex flex-nowrap items-center justify-start gap-1 h-8 rounded-md px-3 text-xs font-medium border border-input bg-background min-w-0',
                    actions.length > 0 && 'rounded-r-none',
                )}
                title={statesTranslationFunction(currentState)}
            >
                <div className="flex-shrink-0">{iconForType[currentStateType]}</div>
                <span className="truncate">{statesTranslationFunction(currentState)}</span>
            </div>
            {actions.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={isLoading}
                                className={cn('rounded-l-none border-l-0 shadow-none', 'bg-background')}
                                data-testid="state-transition-trigger"
                            />
                        }
                    >
                        <EllipsisVertical aria-hidden="true" className="h-4 w-4" />
                        <span className="sr-only">
                            <Trans>Change status</Trans>
                        </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                        {actions.map((action, index) => {
                            return (
                                <DropdownMenuItem
                                    key={`${action.label}-${index}`}
                                    onClick={() => {
                                        if (action.confirmation) {
                                            setPendingAction(action);
                                        } else {
                                            action.onClick();
                                        }
                                    }}
                                    variant={action.type === 'destructive' ? 'destructive' : 'default'}
                                    disabled={action.disabled || isLoading}
                                >
                                    {iconForType[action.type ?? 'default']}
                                    {action.label}
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            <AlertDialog open={pendingAction != null} onOpenChange={open => !open && setPendingAction(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{pendingAction?.confirmation?.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingAction?.confirmation?.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            <Trans>Cancel</Trans>
                        </AlertDialogCancel>
                        <AlertDialogAction
                            type="button"
                            onClick={() => {
                                pendingAction?.onClick();
                                setPendingAction(null);
                            }}
                        >
                            {pendingAction?.confirmation?.confirmText ?? <Trans>Continue</Trans>}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
