import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ResultOf } from 'gql.tada';
import { PlusIcon } from 'lucide-react';
import { roleItemFragment } from '../roles.graphql.js';
import { getPermissionDisplay } from './permission-labels.js';

export function ExpandablePermissions({ role }: Readonly<{ role: ResultOf<typeof roleItemFragment> }>) {
    const { i18n } = useLingui();
    const permissionsToPreview = role.permissions.slice(0, 3);

    return (
        <div className="flex flex-wrap gap-2 items-center">
            {permissionsToPreview.map(permission => (
                <Badge variant={'secondary'} key={permission}>
                    {getPermissionDisplay(i18n, permission).fullLabel}
                </Badge>
            ))}
            {role.permissions.length > permissionsToPreview.length && (
                <Dialog>
                    <DialogTrigger render={<Button size={'xs'} variant={'secondary'} />}>
                        <PlusIcon /> {role.permissions.length - permissionsToPreview.length}
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                <Trans>Permissions for {role.code}</Trans>
                            </DialogTitle>
                            <DialogDescription>
                                <Trans>{role.permissions.length} permissions in total</Trans>
                            </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="max-h-[300px]">
                            <div className="flex flex-wrap gap-2">
                                {role.permissions.map(permission => (
                                    <Badge variant={'secondary'} key={permission}>
                                        {getPermissionDisplay(i18n, permission).fullLabel}
                                    </Badge>
                                ))}
                            </div>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
