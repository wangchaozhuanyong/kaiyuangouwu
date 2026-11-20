// organize-imports-ignore -- Keep ESLint type import grouping.
import type { StorefrontLanguage } from '../../types';
import {
    BookUser,
    Camera,
    Check,
    ChevronRight,
    Flower2,
    Image,
    PenLine,
    Plus,
    ShieldCheck,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { Sheet, Subpage, SubpageBody } from '../../storefront-ui/page-shell';

import './mdac.css';
import { MdacFieldHelp } from './field-help';
import { MdacHotelPicker, type MdacHotel } from './hotel-picker';
import {
    AIR_TRAVEL,
    contactFields,
    disableDraftSaving,
    draftSavingPreference,
    emptyDraft,
    exportConfig,
    HOTEL_STAY,
    lodgingFields,
    malaysiaToday,
    normalizeFlightNumber,
    OFFICIAL_URL,
    PassportReadError,
    persistDraft,
    personalFields,
    readDraft,
    STORAGE_KEY,
    suggestedDepartureDate,
    travelFields,
    validateDates,
    validPersonalFields,
    type Draft,
    type Field,
    type Fields,
} from './model';

export function MdacPage({
    language: initialLanguage,
    onBack,
    storeName,
}: {
    language: StorefrontLanguage;
    onBack?: () => void;
    storeName?: string;
}) {
    const [chosenLanguage, setChosenLanguage] = useState<StorefrontLanguage>();
    const language = chosenLanguage ?? initialLanguage;
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const [draft, setDraft] = useState<Draft>(() => readDraft() ?? emptyDraft());
    const [preference] = useState(draftSavingPreference);
    const [remember, setRemember] = useState(preference === true);
    const [saved, setSaved] = useState(() => Boolean(readDraft()));
    const [storageFailed, setStorageFailed] = useState(preference === null);
    const [privacyOpen, setPrivacyOpen] = useState(false);
    const [traveler, setTraveler] = useState(0);
    const [step, setStep] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [departureIsSuggested, setDepartureIsSuggested] = useState(false);
    const [checkDeparture, setCheckDeparture] = useState(false);
    const [flightReviewed, setFlightReviewed] = useState(false);
    const [confirmedTrip, setConfirmedTrip] = useState(false);
    const fieldId = useId();
    const heading = useRef<HTMLHeadingElement>(null);
    const editField = useRef<string | null>(null);
    const previousStep = useRef(step);
    useEffect(() => {
        if (step !== previousStep.current) {
            previousStep.current = step;
            const target = editField.current
                ? document.getElementById(fieldId + '-' + editField.current)
                : heading.current;
            editField.current = null;
            target?.focus({ preventScroll: true });
            target?.scrollIntoView?.({ block: 'start' });
        }
    }, [step, fieldId]);
    const byAir = draft.shared.trvlMode === AIR_TRAVEL;
    const flight = normalizeFlightNumber(draft.shared.vesselNm ?? '');
    const showFlightHint =
        byAir && flightReviewed && flight && !/^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$/u.test(flight);
    const generation = useRef(0);
    const imageInput = useRef<HTMLInputElement>(null);
    const albumInput = useRef<HTMLInputElement>(null);
    const scanController = useRef<AbortController | null>(null);
    const rememberRef = useRef(remember);
    rememberRef.current = remember;
    useEffect(
        () => () => {
            generation.current++;
            scanController.current?.abort();
        },
        [],
    );
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY || event.key === null) {
                // Another tab's deletion or edit must never be silently overwritten.
                setRemember(false);
                rememberRef.current = false;
                setSaved(false);
                setMessage(
                    t(
                        '其他页面已更改本机草稿，当前输入已保留，请核对后重新选择保存。',
                        'Another tab changed the draft. Review this page before enabling local saving again.',
                    ),
                );
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [language]);
    function save(next: Draft, keep = remember) {
        setDraft(next);
        if (keep && draftSavingPreference() === false) {
            setRemember(false);
            rememberRef.current = false;
            setSaved(false);
            return true;
        }
        if (keep && !persistDraft(next, true)) {
            setStorageFailed(true);
            setSaved(false);
            setMessage(
                t(
                    '浏览器无法保存资料，请保持此页打开。',
                    'Local storage is unavailable. Keep this page open.',
                ),
            );
            return false;
        }
        if (keep) {
            setStorageFailed(false);
            setSaved(true);
        }
        return true;
    }
    function update(field: Field, value: string, personal: boolean) {
        const next = personal
            ? {
                  ...draft,
                  travelers: draft.travelers.map((item, index) =>
                      index === traveler ? { ...item, [field.key]: value } : item,
                  ),
              }
            : { ...draft, shared: { ...draft.shared, [field.key]: value } };
        if (!personal && field.key === 'arrDt' && value !== draft.shared.arrDt) {
            if (departureIsSuggested || !draft.shared.depDt) {
                next.shared.depDt = suggestedDepartureDate(value);
                setDepartureIsSuggested(Boolean(next.shared.depDt));
                setCheckDeparture(false);
            } else {
                setCheckDeparture(true);
            }
        }
        if (!personal && field.key === 'depDt') {
            setDepartureIsSuggested(false);
            setCheckDeparture(false);
        }
        if (!personal && field.key === 'vesselNm') setFlightReviewed(false);
        save(next);
    }
    function selectHotel(hotel: MdacHotel) {
        save({
            ...draft,
            shared: {
                ...draft.shared,
                accommodationAddress1: hotel.address,
                accommodationAddress2: hotel.address2 ?? '',
                accommodationState: hotel.state,
                accommodationCity: hotel.city,
                accommodationPostcode: hotel.postcode,
            },
        });
    }
    function normalizeFlight() {
        if (byAir && flight !== (draft.shared.vesselNm ?? '')) {
            save({ ...draft, shared: { ...draft.shared, vesselNm: flight } });
        }
        setFlightReviewed(true);
    }
    async function scan(file: File) {
        const current = ++generation.current;
        const controller = new AbortController();
        scanController.current = controller;
        const timeout = window.setTimeout(() => {
            if (current !== generation.current || controller.signal.aborted) return;
            controller.abort();
            setBusy(false);
            setMessage(
                t('识别超时，请重试或手动填写。', 'Recognition timed out. Retry or enter details manually.'),
            );
        }, 60000);
        setBusy(true);
        setMessage(t('正在本机识别护照…', 'Reading the passport on this device…'));
        try {
            const { readPassport } = await import('./ocr');
            const recognized = await readPassport(file, controller.signal);
            if (current !== generation.current || controller.signal.aborted) return;
            const updated = save(
                {
                    ...draft,
                    travelers: draft.travelers.map((item, index) =>
                        index === traveler ? { ...item, ...recognized } : item,
                    ),
                },
                rememberRef.current,
            );
            if (updated)
                setMessage(
                    recognized.pob
                        ? t(
                              '识别完成，已根据护照出生地点匹配出生国家／地区。请逐项核对，尤其是出生年份和出生地。',
                              'Recognition complete. The birth country / region was matched from the passport’s birth field. ' +
                                  'Review every field, especially birth year and birthplace.',
                          )
                        : t(
                              '护照资料识别完成；出生地未能可靠识别，请补充或核对出生国家／地区，并逐项检查其他资料。',
                              'Passport details read. Birthplace could not be read reliably; enter or check the birth country / region and review the other fields.',
                          ),
                );
        } catch (error) {
            if (current === generation.current && !controller.signal.aborted)
                setMessage(
                    error instanceof PassportReadError && error.code === 'image'
                        ? t(
                              '请选择不超过 10 MB 的 JPG、PNG 或 WebP 照片。',
                              'Choose a JPG, PNG or WebP image up to 10 MB.',
                          )
                        : error instanceof PassportReadError && error.code === 'recognition'
                          ? t(
                                '未能完整识别护照底部两行机读码。请拍清资料页、避免反光，或手动填写。',
                                'Could not verify both MRZ lines. Retake a clear data-page photo without glare, or enter details manually.',
                            )
                          : t(
                                '本机识别组件或照片加载失败，请重试，或手动填写。',
                                'The local recognition engine or image could not load. Retry or enter details manually.',
                            ),
                );
        } finally {
            window.clearTimeout(timeout);
            if (current === generation.current) setBusy(false);
            if (imageInput.current) imageInput.current.value = '';
        }
    }
    function advance(event: FormEvent) {
        event.preventDefault();
        setMessage('');
        if (step === 1) {
            if (byAir && !flight) {
                setMessage(
                    t(
                        '请填写抵达马来西亚的航班号。',
                        'Enter the flight number for your arrival in Malaysia.',
                    ),
                );
                return;
            }
            const today = malaysiaToday();
            const missing = draft.travelers.findIndex(
                person => !validPersonalFields(person) || !validateDates(person, draft.shared, today),
            );
            if (missing >= 0) {
                setMessage(
                    t(
                        '请补齐所有旅客资料，并核对生日、护照到期日和入离境日期。',
                        'Complete all travelers and check birth, expiry and travel dates.',
                    ),
                );
                setTraveler(missing);
                setStep(0);
                return;
            }
            normalizeFlight();
            setConfirmedTrip(false);
            const delta = (Date.parse(draft.shared.arrDt) - Date.parse(today)) / 86400000;
            if (delta > 2) {
                setMessage(
                    t(
                        '当前超出官网三天填报窗口，请临近抵达时再提交。可继续核对并保存草稿。',
                        'Outside the official three-day filing window. Review and save a draft for later.',
                    ),
                );
            }
        }
        setStep(step + 1);
    }
    function download() {
        if (!confirmedTrip) return;
        const blob = new Blob([JSON.stringify(exportConfig(draft), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mdac-travelers.json';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage(
            t(
                '资料已导出到你的设备。请在官网填表脚本的 Import 中导入文件内容。',
                'Exported to your device. Paste the file contents into Import in the official-page userscript.',
            ),
        );
    }
    function clear() {
        generation.current++;
        scanController.current?.abort();
        setBusy(false);
        setRemember(false);
        rememberRef.current = false;
        setSaved(false);
        setPrivacyOpen(false);
        setTraveler(0);
        setStep(0);
        setDepartureIsSuggested(false);
        setCheckDeparture(false);
        setFlightReviewed(false);
        setConfirmedTrip(false);
        if (imageInput.current) imageInput.current.value = '';
        save(emptyDraft(), false);
        const cleared = disableDraftSaving();
        setStorageFailed(!cleared);
        setMessage(
            cleared
                ? t(
                      '本站本机草稿已清除。已下载文件与脚本中的资料需分别删除。',
                      'Local site draft cleared. Delete downloaded files and userscript data separately.',
                  )
                : t(
                      '当前输入已清空，浏览器未能确认本机设置。请在浏览器设置中检查本站数据。',
                      'Page inputs cleared. The browser could not confirm local storage settings. Check this site’s data in your browser.',
                  ),
        );
    }
    function changeRetention(keep: boolean) {
        const ok = keep ? persistDraft(draft, true) : disableDraftSaving();
        rememberRef.current = keep && ok;
        setRemember(keep && ok);
        setSaved(keep && ok);
        setStorageFailed(!ok);
        setMessage(
            ok
                ? ''
                : t(
                      '浏览器无法更新本机草稿设置，请查看浏览器的站点存储设置。',
                      'Could not update the draft. Check the browser’s site storage settings.',
                  ),
        );
    }
    function chooseImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void scan(file);
    }
    const stepActions = (
        <div className="mdac-actions mdac-navigation">
            {step > 0 && (
                <button
                    type="button"
                    className="secondary-action type-action"
                    onClick={() => setStep(step - 1)}
                >
                    {t('上一步', 'Back')}
                </button>
            )}
            {step < 2 && (
                <button className="mdac-primary type-action" type="submit" disabled={busy}>
                    {busy ? t('识别中…', 'Reading…') : t('下一步', 'Next')}
                </button>
            )}
        </div>
    );
    const fieldHelp: Record<string, string> = {
        email: t(
            '填写能收到入境卡回执的邮箱，例如 name@example.com。',
            'Use an email address that can receive your confirmation, such as name@example.com.',
        ),
        arrDt: t(
            '按马来西亚当地落地日期填写。例如 1 日 22:00 起飞、2 日凌晨 03:00 落地，填写 2 日。',
            'Enter the local date you land in Malaysia. If you take off at 22:00 on the 1st and land at 03:00 on the 2nd, enter the 2nd.',
        ),
        depDt: t(
            '以抵达当天为第 1 天，自动建议第 30 天。请按实际票据填写，获准停留期限以入境许可为准。',
            'The suggested date is day 30, counting arrival as day 1. Use the date on your ticket and follow the stay permitted at entry.',
        ),
        vesselNm: byAir
            ? t(
                  '在订票软件的订单详情中，查找实际飞抵马来西亚那一段的航班号，例如 MH123。',
                  'Find the flight number for the leg into Malaysia in your booking app, for example MH123.',
              )
            : t(
                  '请在票据或行程单上查找抵马段的交通工具编号。',
                  'Find the transport number for the leg into Malaysia on your ticket or itinerary.',
              ),
        embark: t(
            '如有转机，请填写飞往马来西亚的最后一段航程从哪里出发。',
            'For a connection, enter the departure point of the last leg into Malaysia.',
        ),
    };
    function optionLabel(field: string, value: string, label: string) {
        if (field === 'region' && value === '60') return t('马来西亚 +60', 'Malaysia +60');
        if (field === 'region' && value === '86') return t('中国 +86', 'China +86');
        if (field === 'trvlMode' && value === AIR_TRAVEL) return t('飞机', 'Air');
        if (field === 'embark' && value === 'CHN') return t('中国', 'China');
        if (field === 'accommodationStay' && value === HOTEL_STAY) return t('酒店', 'Hotel');
        return label;
    }
    function reviewField(field: Field) {
        const value = draft.shared[field.key];
        const option = field.options?.find(([code]) => code === value);
        return option ? optionLabel(field.key, value, option[1]) : value || '—';
    }
    function fields(items: Field[], values: Fields, personal: boolean) {
        return (
            <div className="mdac-fields">
                {items.map(field => {
                    const id = `${fieldId}-${field.key}`;
                    const label = t(field.zh, field.en);
                    const help = fieldHelp[field.key];
                    const advisory =
                        field.key === 'depDt' && checkDeparture
                            ? t(
                                  '抵达日期已更改，请重新核对实际离境日期。',
                                  'Arrival has changed. Review your actual departure date.',
                              )
                            : field.key === 'vesselNm' && showFlightHint
                              ? t(
                                    '请核对航班号是否与订单一致，例如 MH123。',
                                    'Check the flight number against your booking, for example MH123.',
                                )
                              : '';
                    const description =
                        [help && id + '-help', advisory && id + '-advisory'].filter(Boolean).join(' ') ||
                        undefined;
                    return (
                        <div className="mdac-field" key={field.key} data-field={field.key}>
                            <div className="mdac-field-heading">
                                <label htmlFor={id} className="type-label">
                                    {label}
                                    {field.optional ? t('（选填）', ' (optional)') : ''}
                                </label>
                                {help && (
                                    <MdacFieldHelp
                                        id={id + '-help'}
                                        label={t(label + '说明', label + ' help')}
                                        text={help}
                                    />
                                )}
                            </div>
                            {field.options ? (
                                <select
                                    id={id}
                                    aria-describedby={description}
                                    value={values[field.key] ?? ''}
                                    required={!field.optional}
                                    disabled={busy}
                                    onChange={event => update(field, event.target.value, personal)}
                                >
                                    <option value="">{t('请选择', 'Select')}</option>
                                    {field.options.map(([value, option], index) => (
                                        <option key={value + index} value={value}>
                                            {optionLabel(field.key, value, option)}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    id={id}
                                    aria-describedby={description}
                                    value={values[field.key] ?? ''}
                                    required={!field.optional}
                                    disabled={busy}
                                    className="type-input"
                                    type={field.type ?? 'text'}
                                    maxLength={field.maxLength ?? 250}
                                    autoComplete="off"
                                    pattern={field.pattern}
                                    placeholder={
                                        field.key === 'email'
                                            ? 'name@example.com'
                                            : field.key === 'vesselNm' && byAir
                                              ? 'MH123'
                                              : undefined
                                    }
                                    onInput={
                                        field.type === 'date'
                                            ? event => update(field, event.currentTarget.value, personal)
                                            : undefined
                                    }
                                    onChange={
                                        field.type !== 'date'
                                            ? event => update(field, event.target.value, personal)
                                            : undefined
                                    }
                                    onBlur={field.key === 'vesselNm' ? normalizeFlight : undefined}
                                />
                            )}
                            {advisory && (
                                <p id={id + '-advisory'} className="type-helper" role="status">
                                    {advisory}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }
    const steps = [
        t('护照资料', 'Passport details'),
        t('行程与联系', 'Travel and contact'),
        t('核对资料', 'Review details'),
    ];
    const storageStatus = storageFailed
        ? t('本机存储不可用', 'Local storage unavailable')
        : remember
          ? saved
              ? t('本机草稿已保存', 'Draft saved on this device')
              : t('本机草稿已开启', 'Local draft saving is on')
          : t('本机草稿已关闭', 'Local draft saving is off');
    const draftSettings = (
        <div className="mdac-draft-bar">
            <div>
                <strong className="type-label">
                    {t('护照照片仅在本机识别', 'Passport photos are processed on this device')}
                </strong>
                <p className="type-helper">{storageStatus}</p>
            </div>
            <button type="button" className="mdac-link type-action" onClick={() => setPrivacyOpen(true)}>
                {t('草稿设置', 'Draft settings')}
                <ChevronRight size={16} />
            </button>
        </div>
    );
    const groups = [
        { title: t('联系方式', 'Contact details'), items: contactFields },
        { title: t('航班与出入境日期', 'Transport and travel dates'), items: travelFields },
        { title: t('在马来西亚的住宿', 'Accommodation in Malaysia'), items: lodgingFields },
    ];
    function editStep(index: number, key: string) {
        setMessage('');
        setConfirmedTrip(false);
        editField.current = key;
        setStep(index);
    }
    const feedback = message && (
        <p className="mdac-message type-helper" role="status">
            {message}
        </p>
    );
    return (
        <Subpage
            className="mdac-page"
            title={t('马来西亚入境卡', 'Malaysia arrival card')}
            language={language}
            onBack={onBack}
            back={onBack ? undefined : <></>}
            titleIcon={
                <>
                    <Flower2 size={22} />
                    {storeName && <b className="mdac-brand">{storeName}</b>}
                </>
            }
            action={
                <button
                    className="mdac-language type-action"
                    type="button"
                    aria-label={t('切换为英文', 'Switch to Chinese')}
                    onClick={() => setChosenLanguage(language === 'zh' ? 'en' : 'zh')}
                >
                    {t('EN', '中文')}
                </button>
            }
        >
            <SubpageBody className="mdac-body" lang={language}>
                <ol className="mdac-steps" aria-label={t('填写进度', 'Progress')}>
                    {steps.map((label, index) => (
                        <li
                            key={index}
                            className="type-meta"
                            aria-current={index === step ? 'step' : undefined}
                        >
                            <span aria-hidden="true">{index < step ? <Check size={14} /> : index + 1}</span>
                            {label}
                        </li>
                    ))}
                </ol>
                <header className="mdac-heading">
                    <h1 tabIndex={-1} ref={heading}>
                        {steps[step]}
                    </h1>
                    <p className="type-body">
                        {
                            [
                                t(
                                    '同行旅客分别填护照，共用一份行程。',
                                    'Each traveler needs a passport. Everyone shares this trip.',
                                ),
                                t(
                                    '请按实际票据和住宿预订填写。',
                                    'Use your actual tickets and accommodation booking.',
                                ),
                                t(
                                    '逐位核对旅客资料，再到移民局官网完成登记。',
                                    'Review each traveler before registering on the official site.',
                                ),
                            ][step]
                        }
                    </p>
                </header>
                <form onSubmit={advance} aria-busy={busy} autoComplete="off">
                    {step === 0 && (
                        <>
                            <div className="mdac-actions mdac-travelers">
                                <label className="type-label">
                                    <select
                                        aria-label={t('当前旅客', 'Traveler')}
                                        value={traveler}
                                        disabled={busy}
                                        onChange={event => setTraveler(Number(event.target.value))}
                                    >
                                        {draft.travelers.map((person, index) => (
                                            <option key={index} value={index}>
                                                {person.name || t('旅客', 'Traveler') + ' ' + (index + 1)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <button
                                    className="secondary-action type-action"
                                    type="button"
                                    disabled={busy || draft.travelers.length >= 20}
                                    onClick={() => {
                                        save({ ...draft, travelers: [...draft.travelers, {}] });
                                        setTraveler(draft.travelers.length);
                                    }}
                                >
                                    <Plus size={15} aria-hidden="true" />
                                    {t('添加旅客', 'Add traveler')}
                                </button>
                                {draft.travelers.length > 1 && (
                                    <button
                                        className="secondary-action type-action"
                                        type="button"
                                        disabled={busy}
                                        onClick={() => {
                                            save({
                                                ...draft,
                                                travelers: draft.travelers.filter(
                                                    (_, index) => index !== traveler,
                                                ),
                                            });
                                            setTraveler(0);
                                        }}
                                    >
                                        {t('移除此旅客', 'Remove traveler')}
                                    </button>
                                )}
                            </div>
                            <section className="mdac-upload">
                                <div className="mdac-upload-title">
                                    <div>
                                        <h2 className="type-section">
                                            {t('拍摄或上传护照资料页', 'Capture or upload your passport')}
                                        </h2>
                                        <p className="type-helper">
                                            {t(
                                                '平放护照，拍清底部两行机读码。',
                                                'Lay the passport flat and include both machine-readable lines.',
                                            )}
                                        </p>
                                    </div>
                                    <BookUser aria-hidden="true" size={42} />
                                </div>
                                <input
                                    hidden
                                    ref={imageInput}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    capture="environment"
                                    aria-label={t('拍摄护照资料页', 'Capture passport photo')}
                                    onChange={chooseImage}
                                    disabled={busy}
                                />
                                <input
                                    hidden
                                    ref={albumInput}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    aria-label={t('选择护照图片文件', 'Choose a passport image file')}
                                    onChange={chooseImage}
                                    disabled={busy}
                                />
                                <button
                                    type="button"
                                    className="mdac-primary mdac-photo type-action"
                                    disabled={busy}
                                    onClick={() => {
                                        const target = window.matchMedia('(pointer: coarse)').matches
                                            ? imageInput
                                            : albumInput;
                                        target.current?.click();
                                    }}
                                >
                                    <Camera size={19} />
                                    <span className="mdac-fine">
                                        {t('选择护照照片', 'Choose passport photo')}
                                    </span>
                                    <span className="mdac-touch">
                                        {t('拍摄护照', 'Take a passport photo')}
                                    </span>
                                </button>
                                <div className="mdac-upload-options">
                                    <button
                                        type="button"
                                        className="mdac-album mdac-link type-label"
                                        disabled={busy}
                                        onClick={() => albumInput.current?.click()}
                                    >
                                        <Image size={16} />
                                        {t('从相册选择', 'Choose from photos')}
                                    </button>
                                    <button
                                        type="button"
                                        className="mdac-link type-label"
                                        disabled={busy}
                                        onClick={() => document.getElementById(fieldId + '-name')?.focus()}
                                    >
                                        <PenLine size={16} />
                                        {t('手动填写', 'Enter manually')}
                                    </button>
                                </div>
                            </section>
                            {feedback}
                            {draftSettings}
                            <section className="mdac-block">
                                <h2 className="type-section">
                                    {t('护照上的个人资料', 'Personal details on the passport')}
                                </h2>
                                <p className="type-helper">
                                    {t(
                                        '识别后逐项核对，也可直接填写。',
                                        'Check each recognized field, or enter the details yourself.',
                                    )}
                                </p>
                                {fields(personalFields, draft.travelers[traveler], true)}
                            </section>
                        </>
                    )}
                    {step === 1 && (
                        <>
                            {feedback}
                            <div className="mdac-trip">
                                <div>
                                    {groups.slice(0, 2).map(group => (
                                        <section className="mdac-block" key={group.items[0].key}>
                                            <h2 className="type-section">{group.title}</h2>
                                            {fields(group.items, draft.shared, false)}
                                        </section>
                                    ))}
                                </div>
                                <section className="mdac-block mdac-lodging">
                                    <h2 className="type-section">{groups[2].title}</h2>
                                    {fields(lodgingFields.slice(0, 1), draft.shared, false)}
                                    {draft.shared.accommodationStay === HOTEL_STAY && (
                                        <div className="mdac-hotel-box">
                                            <div className="mdac-map" aria-hidden="true" />
                                            <MdacHotelPicker language={language} onSelect={selectHotel} />
                                        </div>
                                    )}
                                    <p className="type-helper">
                                        {t(
                                            '可直接手填实际住宿地址。',
                                            'You can also enter your actual address below.',
                                        )}
                                    </p>
                                    {fields(lodgingFields.slice(1), draft.shared, false)}
                                </section>
                            </div>
                            {draftSettings}
                        </>
                    )}
                    {step === 2 && (
                        <>
                            {feedback}
                            <section className="mdac-block">
                                <h2 className="type-section">{t('逐位核对旅客', 'Review each traveler')}</h2>
                                {draft.travelers.map((person, index) => (
                                    <details key={index} open={index === 0} className="mdac-person-review">
                                        <summary className="type-card">{person.name}</summary>
                                        <dl className="mdac-review">
                                            {personalFields.map(field => (
                                                <div key={field.key}>
                                                    <dt className="type-helper">{t(field.zh, field.en)}</dt>
                                                    <dd>
                                                        {field.options?.find(
                                                            ([code]) => code === person[field.key],
                                                        )?.[1] ?? person[field.key]}
                                                    </dd>
                                                </div>
                                            ))}
                                        </dl>
                                        <button
                                            type="button"
                                            className="mdac-link type-action"
                                            onClick={() => {
                                                setTraveler(index);
                                                editStep(0, 'name');
                                            }}
                                        >
                                            {t('修改旅客资料', 'Edit traveler')}
                                        </button>
                                    </details>
                                ))}
                            </section>
                            <section className="mdac-block">
                                <h2 className="type-section">{t('本次行程', 'This trip')}</h2>
                                {groups.map(group => (
                                    <section className="mdac-summary" key={group.items[0].key}>
                                        <div className="mdac-summary-heading">
                                            <h3 className="type-card">{group.title}</h3>
                                            <button
                                                type="button"
                                                className="mdac-link type-action"
                                                aria-label={t('修改', 'Edit ') + group.title}
                                                onClick={() => editStep(1, group.items[0].key)}
                                            >
                                                {t('修改', 'Edit')}
                                            </button>
                                        </div>
                                        <dl className="mdac-review">
                                            {group.items.map(field => (
                                                <div key={field.key}>
                                                    <dt className="type-helper">{t(field.zh, field.en)}</dt>
                                                    <dd>{reviewField(field)}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </section>
                                ))}
                            </section>
                            <section className="mdac-handoff">
                                <p className="type-helper">
                                    {t(
                                        '普通手机浏览器若不支持扩展，可保留此页，对照填写官网。桌面端可在支持油猴扩展的浏览器中安装 MDAC 脚本，将导出的 JSON 内容导入，再选择旅客自动填表。每位旅客需在官网核对、完成验证并提交。',
                                        'On mobile without extension support, copy the reviewed details into the official form. ' +
                                            'On desktop, install the MDAC userscript in a compatible browser, import the exported JSON ' +
                                            'and select a traveler to fill the form. Review, verify and submit each traveler on the official site.',
                                    )}
                                </p>
                                <label className="mdac-check type-label">
                                    <input
                                        type="checkbox"
                                        checked={confirmedTrip}
                                        onChange={event => setConfirmedTrip(event.target.checked)}
                                    />
                                    {t(
                                        '我已核对实际离境日期和住宿地址。',
                                        'I have checked my actual departure date and accommodation address.',
                                    )}
                                </label>
                                <div className="mdac-actions">
                                    <a
                                        href="/mdac/mdac-autofill.user.js"
                                        className="secondary-action type-action"
                                    >
                                        {t('安装填表脚本', 'Install userscript')}
                                    </a>
                                    <button
                                        type="button"
                                        className="secondary-action type-action"
                                        disabled={!confirmedTrip}
                                        onClick={download}
                                    >
                                        {t('导出填表资料', 'Export details')}
                                    </button>
                                    <a
                                        className="mdac-primary type-action"
                                        href={OFFICIAL_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t('打开官方登记页', 'Open official registration')}
                                    </a>
                                </div>
                            </section>
                            {draftSettings}
                        </>
                    )}
                    {stepActions}
                </form>
                {privacyOpen && (
                    <Sheet
                        title={t('隐私安全', 'Privacy and security')}
                        titleIcon={<ShieldCheck size={19} aria-hidden="true" />}
                        language={language}
                        showHandle
                        initialFocus="dialog"
                        className="mdac-privacy"
                        onClose={() => setPrivacyOpen(false)}
                    >
                        <div className="mdac-sheet-body">
                            <label className="mdac-setting type-label">
                                <span>{t('保留本机草稿', 'Keep a local draft')}</span>
                                <input
                                    type="checkbox"
                                    checked={remember}
                                    onChange={e => changeRetention(e.target.checked)}
                                />
                            </label>
                            <p className="type-helper">
                                {t(
                                    '在同一浏览器可接着填写。若使用共用设备，可在这里关闭。',
                                    'Continue in this browser next time. Turn this off on a shared device.',
                                )}
                            </p>
                            {storageFailed && (
                                <p className="mdac-message type-helper" role="status">
                                    {t(
                                        '浏览器无法更新存储，请检查本站存储权限。',
                                        'Could not update storage. Check this site’s storage permissions.',
                                    )}
                                </p>
                            )}
                            <h3 className="type-card">
                                {t('资料存放在哪里？', 'Where are my details kept?')}
                            </h3>
                            <p className="type-helper">
                                {t(
                                    '护照照片在本机识别。草稿仅保存在此浏览器；在官网提交时，资料由马来西亚移民局接收。',
                                    'Passport photos are read on this device. Drafts stay in this browser. Official submissions go to Malaysian Immigration.',
                                )}
                            </p>
                            <button className="mdac-clear type-action" type="button" onClick={clear}>
                                {t('清除本机资料', 'Clear local details')}
                            </button>
                        </div>
                    </Sheet>
                )}
            </SubpageBody>
        </Subpage>
    );
}
