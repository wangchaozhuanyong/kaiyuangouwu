import { useLingui } from '@lingui/react';
import {
    Alert,
    AlertDescription,
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Badge,
    Button,
    Input,
    Label,
    Skeleton,
    api,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { ClipboardCopy, ExternalLink, Globe2, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { KeyboardEvent, useState } from 'react';

import {
    StoreDomainItem,
    StoreDomainsResult,
    createStoreDomainMutation,
    deleteStoreDomainMutation,
    setPrimaryStoreDomainMutation,
    storeDomainsQuery,
    verifyStoreDomainMutation,
} from './store-domain.graphql';

interface StoreDomainPageBlockProps {
    context: { entity?: { id?: string } };
}

const zhCopy = {
    title: '专属域名',
    description: '验证域名所有权后，访问该域名会自动进入当前店铺。',
    inputLabel: '添加外部域名',
    inputPlaceholder: 'shop.example.com',
    add: '添加域名',
    empty: '还没有绑定域名',
    emptyHint: '添加后按提示配置 DNS，验证通过即可生效。',
    loadError: '域名列表加载失败',
    retry: '重试',
    pending: '待验证',
    active: '已生效',
    primary: '主域名',
    cname: '访问记录',
    txt: '所有权验证',
    recordType: '类型',
    recordName: '主机记录',
    recordValue: '记录值',
    verify: '验证 DNS',
    verifying: '正在验证',
    makePrimary: '设为主域名',
    visit: '访问域名',
    delete: '删除域名',
    deleteTitle: '删除这个域名？',
    deleteDescription: '删除后，该域名将立即停止路由到当前店铺。DNS 记录不会被自动删除。',
    cancel: '取消',
    copied: '已复制',
    added: '域名已添加，请配置 DNS 记录',
    primaryUpdated: '主域名已更新',
    deleted: '域名已删除',
    copy: '复制',
};

const enCopy: typeof zhCopy = {
    title: 'Custom domains',
    description: 'After ownership verification, this domain will automatically open the current store.',
    inputLabel: 'Add external domain',
    inputPlaceholder: 'shop.example.com',
    add: 'Add domain',
    empty: 'No domains connected',
    emptyHint: 'Add a domain, configure the DNS records, then verify it to activate routing.',
    loadError: 'Could not load domains',
    retry: 'Retry',
    pending: 'Pending verification',
    active: 'Active',
    primary: 'Primary',
    cname: 'Traffic record',
    txt: 'Ownership verification',
    recordType: 'Type',
    recordName: 'Name',
    recordValue: 'Value',
    verify: 'Verify DNS',
    verifying: 'Verifying',
    makePrimary: 'Make primary',
    visit: 'Visit domain',
    delete: 'Delete domain',
    deleteTitle: 'Delete this domain?',
    deleteDescription:
        'The domain will stop routing to this store immediately. Its DNS records are not removed.',
    cancel: 'Cancel',
    copied: 'Copied',
    added: 'Domain added. Configure its DNS records.',
    primaryUpdated: 'Primary domain updated',
    deleted: 'Domain deleted',
    copy: 'Copy',
};

export function StoreDomainPageBlock({ context }: Readonly<StoreDomainPageBlockProps>) {
    const channelId = context.entity?.id;
    const { i18n } = useLingui();
    const text = i18n.locale.toLowerCase().startsWith('zh') ? zhCopy : enCopy;
    const queryClient = useQueryClient();
    const [newDomain, setNewDomain] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<StoreDomainItem | null>(null);
    const queryKey = ['store-domains', channelId];
    const domainQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StoreDomainsResult>(storeDomainsQuery, { channelId }),
        enabled: Boolean(channelId),
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey });

    const createMutation = useMutation({
        mutationFn: (domain: string) =>
            api.mutate(createStoreDomainMutation, { input: { channelId, domain } }),
        onSuccess: async () => {
            setNewDomain('');
            toast.success(text.added);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const verifyMutation = useMutation({
        mutationFn: (id: string) =>
            api.mutate(verifyStoreDomainMutation, { id }) as Promise<{
                verifyStoreDomain: { success: boolean; message: string };
            }>,
        onSuccess: async result => {
            const verification = result.verifyStoreDomain;
            if (verification.success) {
                toast.success(verification.message);
            } else {
                toast.error(verification.message);
            }
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const primaryMutation = useMutation({
        mutationFn: (id: string) => api.mutate(setPrimaryStoreDomainMutation, { id }),
        onSuccess: async () => {
            toast.success(text.primaryUpdated);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.mutate(deleteStoreDomainMutation, { id }),
        onSuccess: async () => {
            setDeleteTarget(null);
            toast.success(text.deleted);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const submit = () => {
        const domain = newDomain.trim();
        if (domain && channelId) {
            createMutation.mutate(domain);
        }
    };

    if (!channelId) {
        return null;
    }

    return (
        <div className="space-y-5">
            <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Globe2 className="size-4" aria-hidden="true" />
                    {text.title}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{text.description}</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor="store-domain-input">{text.inputLabel}</Label>
                    <Input
                        id="store-domain-input"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={newDomain}
                        placeholder={text.inputPlaceholder}
                        onChange={event => setNewDomain(event.target.value)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                submit();
                            }
                        }}
                    />
                </div>
                <Button
                    type="button"
                    disabled={!newDomain.trim() || createMutation.isPending}
                    onClick={submit}
                >
                    <Plus className="size-4" aria-hidden="true" />
                    {text.add}
                </Button>
            </div>

            {domainQuery.isPending ? (
                <div className="space-y-3" aria-label={text.title} aria-busy="true">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                </div>
            ) : domainQuery.isError ? (
                <Alert variant="destructive">
                    <AlertDescription className="flex items-center justify-between gap-3">
                        <span>{text.loadError}</span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void domainQuery.refetch()}
                        >
                            <RefreshCw className="size-4" aria-hidden="true" />
                            {text.retry}
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : domainQuery.data.storeDomains.length === 0 ? (
                <div className="border-t py-6 text-center">
                    <p className="text-sm font-medium">{text.empty}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{text.emptyHint}</p>
                </div>
            ) : (
                <div className="divide-y border-y">
                    {domainQuery.data.storeDomains.map(domain => (
                        <DomainRow
                            key={domain.id}
                            domain={domain}
                            cnameTarget={domainQuery.data.storeDomainConfiguration.cnameTarget}
                            text={text}
                            verifyPending={verifyMutation.isPending && verifyMutation.variables === domain.id}
                            actionPending={primaryMutation.isPending || deleteMutation.isPending}
                            onVerify={() => verifyMutation.mutate(domain.id)}
                            onMakePrimary={() => primaryMutation.mutate(domain.id)}
                            onDelete={() => setDeleteTarget(domain)}
                        />
                    ))}
                </div>
            )}

            <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{text.deleteTitle}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget?.domain ? `${deleteTarget.domain}：` : ''}
                            {text.deleteDescription}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>
                            {text.cancel}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleteMutation.isPending}
                            onClick={event => {
                                event.preventDefault();
                                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                            }}
                        >
                            {text.delete}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function DomainRow({
    domain,
    cnameTarget,
    text,
    verifyPending,
    actionPending,
    onVerify,
    onMakePrimary,
    onDelete,
}: Readonly<{
    domain: StoreDomainItem;
    cnameTarget: string;
    text: typeof zhCopy;
    verifyPending: boolean;
    actionPending: boolean;
    onVerify: () => void;
    onMakePrimary: () => void;
    onDelete: () => void;
}>) {
    const active = domain.status === 'ACTIVE';
    return (
        <div className="space-y-4 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all text-sm font-medium">{domain.domain}</span>
                        <Badge variant={active ? 'default' : 'secondary'}>
                            {active ? text.active : text.pending}
                        </Badge>
                        {domain.isPrimary && <Badge variant="outline">{text.primary}</Badge>}
                    </div>
                    {domain.lastVerificationError && (
                        <p className="mt-1 text-xs text-destructive">{domain.lastVerificationError}</p>
                    )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button
                        size="sm"
                        variant="outline"
                        render={<a href={`https://${domain.domain}`} target="_blank" rel="noreferrer" />}
                    >
                        <ExternalLink className="size-4" aria-hidden="true" />
                        {text.visit}
                    </Button>
                    {!active && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={verifyPending}
                            onClick={onVerify}
                        >
                            <RefreshCw
                                className={verifyPending ? 'size-4 animate-spin' : 'size-4'}
                                aria-hidden="true"
                            />
                            {verifyPending ? text.verifying : text.verify}
                        </Button>
                    )}
                    {active && !domain.isPrimary && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={actionPending}
                            onClick={onMakePrimary}
                        >
                            <Star className="size-4" aria-hidden="true" />
                            {text.makePrimary}
                        </Button>
                    )}
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={actionPending}
                        aria-label={text.delete}
                        title={text.delete}
                        onClick={onDelete}
                    >
                        <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                </div>
            </div>

            {!active && (
                <div className="grid gap-3 lg:grid-cols-2">
                    <DnsRecord
                        title={text.cname}
                        type="CNAME / ALIAS"
                        name={domain.domain}
                        value={cnameTarget}
                        text={text}
                    />
                    <DnsRecord
                        title={text.txt}
                        type="TXT"
                        name={domain.verificationRecordName}
                        value={domain.verificationRecordValue}
                        text={text}
                    />
                </div>
            )}
        </div>
    );
}

function DnsRecord({
    title,
    type,
    name,
    value,
    text,
}: Readonly<{ title: string; type: string; name: string; value: string; text: typeof zhCopy }>) {
    return (
        <div className="min-w-0 rounded-md bg-muted/40 p-3 text-xs">
            <p className="mb-2 font-medium">{title}</p>
            <RecordValue
                label={text.recordType}
                value={type}
                copyLabel={text.copy}
                copiedLabel={text.copied}
            />
            <RecordValue
                label={text.recordName}
                value={name}
                copyLabel={text.copy}
                copiedLabel={text.copied}
            />
            <RecordValue
                label={text.recordValue}
                value={value}
                copyLabel={text.copy}
                copiedLabel={text.copied}
            />
        </div>
    );
}

function RecordValue({
    label,
    value,
    copyLabel,
    copiedLabel,
}: Readonly<{ label: string; value: string; copyLabel: string; copiedLabel: string }>) {
    const copy = async () => {
        await navigator.clipboard.writeText(value);
        toast.success(copiedLabel);
    };
    return (
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-2 py-1">
            <span className="text-muted-foreground">{label}</span>
            <code className="break-all text-foreground">{value || '-'}</code>
            <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={!value}
                aria-label={`${copyLabel} ${label}`}
                title={`${copyLabel} ${label}`}
                onClick={() => void copy()}
            >
                <ClipboardCopy className="size-3.5" aria-hidden="true" />
            </Button>
        </div>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
