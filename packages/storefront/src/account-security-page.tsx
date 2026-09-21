import { useNavigate } from '@tanstack/react-router';
import {
    AlertTriangle,
    ArrowLeft,
    Camera,
    CheckCircle2,
    ChevronRight,
    Download,
    FileJson,
    History,
    KeyRound,
    LoaderCircle,
    LogOut,
    Mail,
    MapPin,
    RotateCcw,
    ShieldCheck,
    Trash2,
    UserRound,
    UserX,
    X,
} from 'lucide-react';
import { ChangeEvent, ReactNode, useEffect, useRef, useState } from 'react';

import { SafeImage } from './safe-image';
import { storefrontErrorMessage } from './storefront-errors';
import { routeNavigateOptions } from './storefront-router';
import {
    ActiveCustomer,
    CustomerAvatarHistoryEntry,
    DataSubjectExportPayload,
    DataSubjectRequest,
    FraudRiskCase,
    StoreCommerceMode,
    StorefrontLanguage,
} from './types';

type AccountRoute = { name: 'login' | 'forgot-password' | 'addresses' };

export const CUSTOMER_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';

export function customerAvatarValidationMessage(
    file: Pick<File, 'size' | 'type'>,
    language: StorefrontLanguage,
): string | null {
    const isZh = language === 'zh';
    if (!file.size) return isZh ? '请选择有效的头像图片' : 'Choose a valid profile photo.';
    if (!CUSTOMER_AVATAR_ACCEPT.split(',').includes(file.type.toLowerCase())) {
        return isZh ? '仅支持 JPG、PNG 或 WebP 图片' : 'Use a JPG, PNG, or WebP image.';
    }
    if (file.size > CUSTOMER_AVATAR_MAX_BYTES) {
        return isZh ? '头像图片不能超过 5MB' : 'Profile photos must be 5MB or smaller.';
    }
    return null;
}

export function AccountSecurityPage({
    customer,
    language,
    storefrontName,
    commerceMode,
    onBack,
    onAvatarChange,
    avatarHistory = [],
    avatarHistoryLoading = false,
    onAvatarRestore,
    onAvatarRemove,
    dataSubjectRequests = [],
    dataSubjectLoading = false,
    fraudRiskCases = [],
    fraudRiskLoading = false,
    onDataExport,
    onRequestAccountClosure,
    onCancelAccountClosure,
    onAppealFraudRiskCase,
    onLogout,
}: {
    customer: ActiveCustomer | null;
    language: StorefrontLanguage;
    storefrontName: string;
    commerceMode?: StoreCommerceMode | null;
    onBack: () => void;
    onAvatarChange: (file: File) => Promise<void>;
    avatarHistory?: CustomerAvatarHistoryEntry[];
    avatarHistoryLoading?: boolean;
    onAvatarRestore?: (retentionId: string) => Promise<void>;
    onAvatarRemove?: () => Promise<void>;
    dataSubjectRequests?: DataSubjectRequest[];
    dataSubjectLoading?: boolean;
    fraudRiskCases?: FraudRiskCase[];
    fraudRiskLoading?: boolean;
    onDataExport?: (password: string) => Promise<DataSubjectExportPayload>;
    onRequestAccountClosure?: (password: string) => Promise<void>;
    onCancelAccountClosure?: () => Promise<void>;
    onAppealFraudRiskCase?: (id: string, reason: string) => Promise<void>;
    onLogout: () => void;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: AccountRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const previewUrlRef = useRef<string | null>(null);
    const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarAction, setAvatarAction] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const [privacyAction, setPrivacyAction] = useState<'export' | 'closure' | 'cancel' | null>(null);
    const [privacyDialog, setPrivacyDialog] = useState<'export' | 'closure' | null>(null);
    const [privacyPassword, setPrivacyPassword] = useState('');
    const [privacyError, setPrivacyError] = useState<string | null>(null);
    const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
    const [riskAppealId, setRiskAppealId] = useState<string | null>(null);
    const [riskAppealReason, setRiskAppealReason] = useState('');
    const [riskAction, setRiskAction] = useState(false);
    const [riskMessage, setRiskMessage] = useState<string | null>(null);

    useEffect(
        () => () => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        },
        [],
    );

    const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        const validationMessage = customerAvatarValidationMessage(file, language);
        if (validationMessage) {
            setAvatarError(validationMessage);
            return;
        }

        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(file);
        setAvatarPreviewUrl(previewUrlRef.current);
        setAvatarError(null);
        setAvatarUploading(true);
        try {
            await onAvatarChange(file);
        } catch (error) {
            setAvatarError(
                error instanceof Error
                    ? storefrontErrorMessage(error, language)
                    : isZh
                      ? '头像上传失败，请重试'
                      : 'Profile photo upload failed. Try again.',
            );
        } finally {
            setAvatarUploading(false);
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
            setAvatarPreviewUrl(null);
        }
    };

    const runAvatarAction = async (key: string, action: () => Promise<void>) => {
        setAvatarAction(key);
        setAvatarError(null);
        try {
            await action();
        } catch (error) {
            setAvatarError(
                error instanceof Error
                    ? storefrontErrorMessage(error, language)
                    : isZh
                      ? '头像操作失败，请重试'
                      : 'Profile photo action failed. Try again.',
            );
        } finally {
            setAvatarAction(null);
        }
    };

    if (!customer) {
        return (
            <Subpage title={isZh ? '账户与安全' : 'Account & Security'} language={language} onBack={onBack}>
                <EmptyState
                    icon={<UserRound size={32} />}
                    title={isZh ? '请先登录' : 'Sign in required'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => navigateTo({ name: 'login' })}
                />
            </Subpage>
        );
    }

    const fullName = `${customer.lastName || ''}${customer.firstName || ''}`.trim();
    const displayName = fullName || customer.emailAddress.split('@')[0] || storefrontName;
    const initial = (fullName || customer.emailAddress).slice(0, 1).toUpperCase();
    const avatarUrl = avatarPreviewUrl ?? customer.avatar?.preview ?? null;
    const activeClosure = dataSubjectRequests.find(
        request =>
            request.requestType === 'ACCOUNT_CLOSURE' &&
            ['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED'].includes(request.status),
    );

    const closePrivacyDialog = () => {
        if (privacyAction) return;
        setPrivacyDialog(null);
        setPrivacyPassword('');
        setPrivacyError(null);
    };

    const submitPrivacyAction = async () => {
        if (!privacyDialog || !privacyPassword || !onDataExport || !onRequestAccountClosure) return;
        setPrivacyAction(privacyDialog);
        setPrivacyError(null);
        try {
            if (privacyDialog === 'export') {
                const exported = await onDataExport(privacyPassword);
                downloadPersonalData(exported);
                setPrivacyNotice(
                    isZh
                        ? `个人数据已生成并下载（校验值 ${exported.sha256.slice(0, 12)}…）`
                        : `Your data was generated and downloaded (checksum ${exported.sha256.slice(0, 12)}…)`,
                );
            } else {
                await onRequestAccountClosure(privacyPassword);
                setPrivacyNotice(
                    isZh
                        ? '注销申请已提交；7 天冷静期内可以撤销'
                        : 'Closure requested. You can cancel during the 7-day cooling-off period.',
                );
            }
            setPrivacyDialog(null);
            setPrivacyPassword('');
        } catch (error) {
            setPrivacyError(
                error instanceof Error
                    ? storefrontErrorMessage(error, language)
                    : isZh
                      ? '操作失败，请稍后重试'
                      : 'The request failed. Try again later.',
            );
        } finally {
            setPrivacyAction(null);
        }
    };

    const cancelClosure = async () => {
        if (!onCancelAccountClosure) return;
        setPrivacyAction('cancel');
        setPrivacyError(null);
        try {
            await onCancelAccountClosure();
            setPrivacyNotice(isZh ? '账户注销申请已撤销' : 'Account closure request cancelled.');
        } catch (error) {
            setPrivacyError(
                error instanceof Error
                    ? storefrontErrorMessage(error, language)
                    : isZh
                      ? '撤销失败，请稍后重试'
                      : 'Cancellation failed. Try again later.',
            );
        } finally {
            setPrivacyAction(null);
        }
    };

    return (
        <main className="page subpage account-security-page">
            <SubHeader
                title={isZh ? '账户与安全' : 'Account & Security'}
                language={language}
                onBack={onBack}
            />

            <div className="security-page-body">
                {/* 1. 用户信息高质感微卡片 */}
                <section className="security-user-card" aria-label={isZh ? '个人信息' : 'Personal info'}>
                    <button
                        type="button"
                        className="security-user-avatar"
                        disabled={avatarUploading}
                        aria-label={isZh ? '更换头像' : 'Change profile photo'}
                        aria-busy={avatarUploading}
                        aria-describedby={avatarError ? 'avatar-upload-message' : undefined}
                        onClick={() => avatarInputRef.current?.click()}
                    >
                        {avatarUrl ? (
                            <SafeImage
                                frameClassName="security-user-avatar-image"
                                className="security-user-avatar-image"
                                src={avatarUrl}
                                alt=""
                            />
                        ) : (
                            <span aria-hidden="true">{initial}</span>
                        )}
                        <span className="security-avatar-edit" aria-hidden="true">
                            {avatarUploading ? <LoaderCircle /> : <Camera />}
                        </span>
                    </button>
                    <input
                        ref={avatarInputRef}
                        className="security-avatar-input"
                        type="file"
                        accept={CUSTOMER_AVATAR_ACCEPT}
                        onChange={event => void handleAvatarChange(event)}
                        tabIndex={-1}
                        aria-hidden="true"
                    />
                    <div className="security-user-meta">
                        <div className="security-user-title-row">
                            <h2 className="security-user-name">{displayName}</h2>
                            <span className="security-status-badge">
                                <CheckCircle2 size={12} aria-hidden="true" />
                                <span>{isZh ? '已认证' : 'Verified'}</span>
                            </span>
                        </div>
                        <p className="security-user-email">{customer.emailAddress}</p>
                        <div className="security-avatar-actions">
                            <button
                                type="button"
                                disabled={avatarUploading || avatarAction !== null}
                                onClick={() => avatarInputRef.current?.click()}
                            >
                                <Camera size={12} aria-hidden="true" />
                                {isZh ? '更换头像' : 'Change photo'}
                            </button>
                            {avatarUrl && onAvatarRemove && (
                                <button
                                    type="button"
                                    className="is-danger"
                                    disabled={avatarUploading || avatarAction !== null}
                                    onClick={() => void runAvatarAction('remove', onAvatarRemove)}
                                >
                                    {avatarAction === 'remove' ? (
                                        <LoaderCircle size={12} aria-hidden="true" />
                                    ) : (
                                        <Trash2 size={12} aria-hidden="true" />
                                    )}
                                    {isZh ? '移除' : 'Remove'}
                                </button>
                            )}
                        </div>
                        {(avatarUploading || avatarError) && (
                            <p
                                id="avatar-upload-message"
                                className={`security-avatar-message${avatarError ? ' is-error' : ''}`}
                                role={avatarError ? 'alert' : 'status'}
                            >
                                {avatarError ?? (isZh ? '正在上传头像…' : 'Uploading profile photo…')}
                            </p>
                        )}
                    </div>
                </section>

                <div className="security-group">
                    <div className="security-group-header">
                        <span>{isZh ? '头像保护' : 'Profile photo protection'}</span>
                    </div>
                    <div className="security-card-list">
                        <div className="security-item-static">
                            <span className="security-item-icon icon-avatar-history" aria-hidden="true">
                                <History size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '30 天可恢复保护' : '30-day recovery protection'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh
                                        ? '当前头像不会因时间自动删除；更换或移除后才进入恢复区'
                                        : 'Your current photo never expires; replaced photos enter recovery first'}
                                </span>
                            </div>
                        </div>
                        {(avatarHistoryLoading || avatarHistory.length > 0) && (
                            <div className="security-avatar-history" aria-live="polite">
                                {avatarHistoryLoading ? (
                                    <span className="security-avatar-history-loading">
                                        <LoaderCircle size={14} aria-hidden="true" />
                                        {isZh ? '正在加载恢复记录…' : 'Loading recovery history…'}
                                    </span>
                                ) : (
                                    avatarHistory.map(entry => (
                                        <div className="security-avatar-history-row" key={entry.id}>
                                            {entry.asset?.preview ? (
                                                <SafeImage
                                                    frameClassName="security-avatar-history-image"
                                                    className="security-avatar-history-image"
                                                    src={entry.asset.preview}
                                                    alt=""
                                                />
                                            ) : (
                                                <span
                                                    className="security-avatar-history-image is-empty"
                                                    aria-hidden="true"
                                                >
                                                    <UserRound size={16} />
                                                </span>
                                            )}
                                            <span className="security-avatar-history-copy">
                                                <strong>{isZh ? '可恢复头像' : 'Recoverable photo'}</strong>
                                                <small>
                                                    {isZh ? '保留至 ' : 'Retained until '}
                                                    {formatAvatarRetentionDate(entry.purgeAfter, language)}
                                                    {entry.legalHold ? (isZh ? '（保留中）' : ' (held)') : ''}
                                                </small>
                                            </span>
                                            {entry.asset && onAvatarRestore && (
                                                <button
                                                    type="button"
                                                    className="security-avatar-restore"
                                                    disabled={avatarAction !== null}
                                                    onClick={() =>
                                                        void runAvatarAction(entry.id, () =>
                                                            onAvatarRestore(entry.id),
                                                        )
                                                    }
                                                >
                                                    {avatarAction === entry.id ? (
                                                        <LoaderCircle size={13} aria-hidden="true" />
                                                    ) : (
                                                        <RotateCcw size={13} aria-hidden="true" />
                                                    )}
                                                    {isZh ? '恢复' : 'Restore'}
                                                </button>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. 核心设置列表 */}
                <div className="security-group">
                    <div className="security-group-header">
                        <span>{isZh ? '账户与登录管理' : 'Account & Login'}</span>
                    </div>
                    <div className="security-card-list">
                        <button
                            type="button"
                            className="security-item-btn"
                            onClick={() => navigateTo({ name: 'forgot-password' })}
                        >
                            <span className="security-item-icon icon-password" aria-hidden="true">
                                <KeyRound size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '修改登录密码' : 'Change Password'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh ? '通过邮箱验证后安全重置' : 'Reset after email verification'}
                                </span>
                            </div>
                            <span className="security-item-tail">
                                <span className="security-tail-text">{isZh ? '去重置' : 'Reset'}</span>
                                <ChevronRight size={15} aria-hidden="true" />
                            </span>
                        </button>

                        <button
                            type="button"
                            className="security-item-btn"
                            onClick={() => navigateTo({ name: 'addresses' })}
                        >
                            <span className="security-item-icon icon-address" aria-hidden="true">
                                {commerceMode === 'DIGITAL_ONLY' ? <Mail size={17} /> : <MapPin size={17} />}
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {commerceMode === 'DIGITAL_ONLY'
                                        ? isZh
                                            ? '交付邮箱管理'
                                            : 'Delivery Emails'
                                        : isZh
                                          ? '收货地址管理'
                                          : 'Delivery Addresses'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {commerceMode === 'DIGITAL_ONLY'
                                        ? isZh
                                            ? '管理数字商品交付邮箱'
                                            : 'Manage digital delivery emails'
                                        : isZh
                                          ? '管理实物商品默认收货地址'
                                          : 'Manage default shipping addresses'}
                                </span>
                            </div>
                            <span className="security-item-tail">
                                <span className="security-tail-text">
                                    {commerceMode === 'DIGITAL_ONLY'
                                        ? isZh
                                            ? '去管理'
                                            : 'Manage'
                                        : isZh
                                          ? `${customer.addresses?.length ?? 0} 个地址`
                                          : `${customer.addresses?.length ?? 0} addresses`}
                                </span>
                                <ChevronRight size={15} aria-hidden="true" />
                            </span>
                        </button>
                    </div>
                </div>

                {/* 3. 安全防护与隐私 */}
                <div className="security-group">
                    <div className="security-group-header">
                        <span>{isZh ? '安全与保护' : 'Security & Protection'}</span>
                    </div>
                    <div className="security-card-list">
                        <div className="security-item-static">
                            <span className="security-item-icon icon-shield" aria-hidden="true">
                                <ShieldCheck size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '账号安全评级' : 'Security Level'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh
                                        ? '已绑定密保邮箱，账户处于高等级保护状态'
                                        : 'Protected with verified email'}
                                </span>
                            </div>
                            <span className="security-safe-badge">
                                <span>{isZh ? '极佳' : 'Optimal'}</span>
                            </span>
                        </div>
                    </div>
                </div>

                {(fraudRiskLoading || fraudRiskCases.length > 0) && (
                    <div className="security-group">
                        <div className="security-group-header">
                            <span>{isZh ? '订单风险复核' : 'Order risk review'}</span>
                        </div>
                        <div className="security-card-list" aria-live="polite">
                            {fraudRiskLoading ? (
                                <div className="security-item-static">
                                    <span className="security-item-icon icon-shield" aria-hidden="true">
                                        <LoaderCircle size={17} />
                                    </span>
                                    <div className="security-item-info">
                                        <strong className="security-item-title">
                                            {isZh ? '正在读取复核状态…' : 'Loading review status…'}
                                        </strong>
                                    </div>
                                </div>
                            ) : (
                                fraudRiskCases.map(riskCase => {
                                    const canAppeal = ['OPEN', 'REJECTED'].includes(riskCase.status);
                                    const pendingAppeal = riskCase.appeals.find(
                                        appeal => appeal.status === 'PENDING',
                                    );
                                    return (
                                        <div className="security-risk-case" key={riskCase.id}>
                                            <div className="security-item-static">
                                                <span
                                                    className="security-item-icon icon-account-closure"
                                                    aria-hidden="true"
                                                >
                                                    <AlertTriangle size={17} />
                                                </span>
                                                <div className="security-item-info">
                                                    <strong className="security-item-title">
                                                        {riskCase.caseCode} ·{' '}
                                                        {riskCaseStatusLabel(riskCase.status, language)}
                                                    </strong>
                                                    <span className="security-item-subtitle">
                                                        {isZh
                                                            ? `订单 ${riskCase.orderId ?? '—'} 暂需人工复核；批准后可继续支付`
                                                            : `Order ${riskCase.orderId ?? '—'} is under manual review; checkout resumes after release.`}
                                                    </span>
                                                </div>
                                            </div>
                                            {pendingAppeal && (
                                                <p className="security-risk-message">
                                                    {isZh
                                                        ? '申诉已提交，等待复核。'
                                                        : 'Appeal submitted and awaiting review.'}
                                                </p>
                                            )}
                                            {canAppeal &&
                                                !pendingAppeal &&
                                                onAppealFraudRiskCase &&
                                                (riskAppealId === riskCase.id ? (
                                                    <div className="security-risk-appeal">
                                                        <textarea
                                                            value={riskAppealReason}
                                                            onChange={event =>
                                                                setRiskAppealReason(event.target.value)
                                                            }
                                                            maxLength={1000}
                                                            placeholder={
                                                                isZh
                                                                    ? '说明订单用途、付款人与其他有助于复核的信息'
                                                                    : 'Explain the order purpose and any details that help the review.'
                                                            }
                                                        />
                                                        <div>
                                                            <button
                                                                type="button"
                                                                disabled={
                                                                    riskAction || !riskAppealReason.trim()
                                                                }
                                                                onClick={() => {
                                                                    setRiskAction(true);
                                                                    setRiskMessage(null);
                                                                    void onAppealFraudRiskCase(
                                                                        riskCase.id,
                                                                        riskAppealReason,
                                                                    )
                                                                        .then(() => {
                                                                            setRiskMessage(
                                                                                isZh
                                                                                    ? '申诉已提交'
                                                                                    : 'Appeal submitted',
                                                                            );
                                                                            setRiskAppealId(null);
                                                                            setRiskAppealReason('');
                                                                        })
                                                                        .catch(error =>
                                                                            setRiskMessage(
                                                                                error instanceof Error
                                                                                    ? storefrontErrorMessage(
                                                                                          error,
                                                                                          language,
                                                                                      )
                                                                                    : isZh
                                                                                      ? '申诉提交失败'
                                                                                      : 'Appeal failed',
                                                                            ),
                                                                        )
                                                                        .finally(() => setRiskAction(false));
                                                                }}
                                                            >
                                                                {riskAction ? (
                                                                    <LoaderCircle size={13} />
                                                                ) : null}
                                                                {isZh ? '提交申诉' : 'Submit appeal'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={riskAction}
                                                                onClick={() => setRiskAppealId(null)}
                                                            >
                                                                {isZh ? '取消' : 'Cancel'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="security-risk-open"
                                                        onClick={() => {
                                                            setRiskAppealId(riskCase.id);
                                                            setRiskAppealReason('');
                                                            setRiskMessage(null);
                                                        }}
                                                    >
                                                        {isZh ? '提交复核说明' : 'Submit review details'}
                                                    </button>
                                                ))}
                                        </div>
                                    );
                                })
                            )}
                            {riskMessage && <p className="security-risk-message">{riskMessage}</p>}
                        </div>
                    </div>
                )}

                <div className="security-group">
                    <div className="security-group-header">
                        <span>{isZh ? '数据与隐私' : 'Data & Privacy'}</span>
                    </div>
                    <div className="security-card-list">
                        <button
                            type="button"
                            className="security-item-btn"
                            disabled={dataSubjectLoading || privacyAction !== null || !onDataExport}
                            onClick={() => {
                                setPrivacyDialog('export');
                                setPrivacyPassword('');
                                setPrivacyError(null);
                            }}
                        >
                            <span className="security-item-icon icon-data-export" aria-hidden="true">
                                <FileJson size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '导出我的个人数据' : 'Export my personal data'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh
                                        ? '包含资料、订单、支付、售后、评价、风险复核与数据请求记录'
                                        : 'Includes profile, orders, payments, support, reviews, risk cases and requests'}
                                </span>
                            </div>
                            <span className="security-item-tail">
                                {dataSubjectLoading ? (
                                    <LoaderCircle size={15} aria-hidden="true" />
                                ) : (
                                    <Download size={15} aria-hidden="true" />
                                )}
                            </span>
                        </button>

                        {activeClosure ? (
                            <div className="security-closure-state">
                                <span className="security-item-icon icon-account-closure" aria-hidden="true">
                                    <UserX size={17} />
                                </span>
                                <div className="security-item-info">
                                    <strong className="security-item-title">
                                        {closureStatusLabel(activeClosure.status, language)}
                                    </strong>
                                    <span className="security-item-subtitle">
                                        {activeClosure.status === 'BLOCKED' ||
                                        activeClosure.status === 'FAILED'
                                            ? activeClosure.lastError ||
                                              (isZh ? '正在等待业务处理' : 'Waiting for operational review')
                                            : activeClosure.dueAt
                                              ? isZh
                                                  ? `计划于 ${formatPrivacyDate(activeClosure.dueAt, language)} 后处理`
                                                  : `Scheduled after ${formatPrivacyDate(activeClosure.dueAt, language)}`
                                              : isZh
                                                ? '申请处理中'
                                                : 'Request in progress'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="security-closure-cancel"
                                    disabled={privacyAction !== null || !onCancelAccountClosure}
                                    onClick={() => void cancelClosure()}
                                >
                                    {privacyAction === 'cancel' ? (
                                        <LoaderCircle size={13} aria-hidden="true" />
                                    ) : (
                                        <X size={13} aria-hidden="true" />
                                    )}
                                    {isZh ? '撤销' : 'Cancel'}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                className="security-item-btn security-item-danger"
                                disabled={
                                    dataSubjectLoading || privacyAction !== null || !onRequestAccountClosure
                                }
                                onClick={() => {
                                    setPrivacyDialog('closure');
                                    setPrivacyPassword('');
                                    setPrivacyError(null);
                                }}
                            >
                                <span className="security-item-icon icon-account-closure" aria-hidden="true">
                                    <UserX size={17} />
                                </span>
                                <div className="security-item-info">
                                    <strong className="security-item-title">
                                        {isZh ? '申请注销账户' : 'Request account closure'}
                                    </strong>
                                    <span className="security-item-subtitle">
                                        {isZh
                                            ? '7 天冷静期；未完成订单、支付、风控、售后或提现会阻止注销'
                                            : '7-day cooling-off; open orders, payments, risk reviews, support or payouts block closure'}
                                    </span>
                                </div>
                                <ChevronRight size={15} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                    {(privacyNotice || privacyError) && (
                        <p
                            className={`security-privacy-message${privacyError ? ' is-error' : ''}`}
                            role={privacyError ? 'alert' : 'status'}
                        >
                            {privacyError ?? privacyNotice}
                        </p>
                    )}
                </div>

                {/* 4. 退出登录 */}
                <div className="security-action-group">
                    <button className="security-logout-button" type="button" onClick={onLogout}>
                        <LogOut size={16} aria-hidden="true" />
                        <span>{isZh ? '退出当前登录账号' : 'Sign Out of Account'}</span>
                    </button>
                </div>
            </div>
            {privacyDialog && (
                <div className="security-privacy-dialog-backdrop" role="presentation">
                    <section
                        className="security-privacy-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="security-privacy-dialog-title"
                    >
                        <button
                            type="button"
                            className="security-privacy-dialog-close"
                            aria-label={isZh ? '关闭' : 'Close'}
                            disabled={privacyAction !== null}
                            onClick={closePrivacyDialog}
                        >
                            <X aria-hidden="true" />
                        </button>
                        <span className="security-privacy-dialog-icon" aria-hidden="true">
                            {privacyDialog === 'export' ? <Download /> : <UserX />}
                        </span>
                        <h2 id="security-privacy-dialog-title">
                            {privacyDialog === 'export'
                                ? isZh
                                    ? '验证后导出个人数据'
                                    : 'Verify and export your data'
                                : isZh
                                  ? '确认申请注销账户'
                                  : 'Confirm account closure request'}
                        </h2>
                        <p>
                            {privacyDialog === 'export'
                                ? isZh
                                    ? '为防止他人下载你的资料，请输入当前登录密码。导出文件仅在本次请求中生成，不会保存文件内容。'
                                    : 'Enter your current password. The export is generated for this request and its file contents are not stored.'
                                : isZh
                                  ? '提交后有 7 天冷静期。到期会先检查未完成订单、支付、风险复核、售后和提现；交易及争议记录会按法定义务继续保留。'
                                  : [
                                        'A 7-day cooling-off period applies.',
                                        'Open orders, payments, risk reviews, support and payouts are checked;',
                                        'legally required transaction and dispute records remain retained.',
                                    ].join(' ')}
                        </p>
                        <label htmlFor="security-privacy-password">
                            {isZh ? '当前账户密码' : 'Current account password'}
                        </label>
                        <input
                            id="security-privacy-password"
                            type="password"
                            autoComplete="current-password"
                            value={privacyPassword}
                            disabled={privacyAction !== null}
                            onChange={event => setPrivacyPassword(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void submitPrivacyAction();
                            }}
                        />
                        {privacyError && <p className="security-privacy-dialog-error">{privacyError}</p>}
                        <div className="security-privacy-dialog-actions">
                            <button
                                type="button"
                                className="is-secondary"
                                disabled={privacyAction !== null}
                                onClick={closePrivacyDialog}
                            >
                                {isZh ? '取消' : 'Cancel'}
                            </button>
                            <button
                                type="button"
                                className={privacyDialog === 'closure' ? 'is-danger' : 'is-primary'}
                                disabled={!privacyPassword || privacyAction !== null}
                                onClick={() => void submitPrivacyAction()}
                            >
                                {privacyAction ? <LoaderCircle aria-hidden="true" /> : null}
                                {privacyDialog === 'export'
                                    ? isZh
                                        ? '验证并下载'
                                        : 'Verify and download'
                                    : isZh
                                      ? '提交注销申请'
                                      : 'Request closure'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}

function downloadPersonalData(payload: DataSubjectExportPayload): void {
    const blob = new Blob([payload.content], { type: payload.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = payload.fileName;
    anchor.rel = 'noopener';
    anchor.click();
    URL.revokeObjectURL(url);
}

function closureStatusLabel(status: DataSubjectRequest['status'], language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    if (status === 'BLOCKED') return isZh ? '注销暂缓处理' : 'Closure temporarily blocked';
    if (status === 'FAILED') return isZh ? '注销处理失败，等待重试' : 'Closure failed and will retry';
    if (status === 'PROCESSING') return isZh ? '正在注销账户' : 'Closing account';
    return isZh ? '账户注销已申请' : 'Account closure requested';
}

function riskCaseStatusLabel(status: FraudRiskCase['status'], language: StorefrontLanguage): string {
    const labels: Record<FraudRiskCase['status'], [string, string]> = {
        OPEN: ['待复核', 'Awaiting review'],
        IN_REVIEW: ['复核中', 'In review'],
        APPEALED: ['申诉复核中', 'Appeal under review'],
        APPROVED: ['已放行', 'Released'],
        REJECTED: ['已拦截', 'Blocked'],
        CLOSED: ['已关闭', 'Closed'],
    };
    return labels[status][language === 'zh' ? 0 : 1];
}

function formatPrivacyDate(value: string, language: StorefrontLanguage): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatAvatarRetentionDate(value: string, language: StorefrontLanguage): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(date);
}

function SubHeader({
    title,
    language,
    onBack,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
}) {
    return (
        <header className="topbar subpage-header">
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span />
        </header>
    );
}

function Subpage({
    title,
    language,
    onBack,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <main className="page subpage">
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}

function EmptyState({
    icon,
    title,
    action,
    onAction,
}: {
    icon: ReactNode;
    title: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <section className="empty-state">
            <span>{icon}</span>
            <h2>{title}</h2>
            <button type="button" onClick={onAction}>
                {action}
            </button>
        </section>
    );
}
