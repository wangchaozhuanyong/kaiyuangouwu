// organize-imports-ignore -- Keep ESLint type import grouping.
import type { StorefrontLanguage } from '../../types';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Subpage, SubpageBody } from '../../storefront-ui/page-shell';

import './mdac.css';
import {
    emptyDraft,
    exportConfig,
    malaysiaToday,
    OFFICIAL_URL,
    PassportReadError,
    persistDraft,
    personalFields,
    readDraft,
    STORAGE_KEY,
    tripFields,
    validateDates,
    validPersonalFields,
    type Draft,
    type Field,
    type Fields,
} from './model';

export function MdacPage({ language, onBack }: { language: StorefrontLanguage; onBack: () => void }) {
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const [draft, setDraft] = useState<Draft>(() => readDraft() ?? emptyDraft());
    const [remember, setRemember] = useState(() => Boolean(readDraft()));
    const [traveler, setTraveler] = useState(0);
    const [step, setStep] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const generation = useRef(0);
    const imageInput = useRef<HTMLInputElement>(null);
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
        if (keep && !persistDraft(next, true)) {
            setMessage(
                t(
                    '浏览器无法保存资料，请保持此页打开。',
                    'Local storage is unavailable. Keep this page open.',
                ),
            );
            return false;
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
        save(next);
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
            const saved = save(
                {
                    ...draft,
                    travelers: draft.travelers.map((item, index) =>
                        index === traveler ? { ...item, ...recognized } : item,
                    ),
                },
                rememberRef.current,
            );
            if (saved)
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
        setTraveler(0);
        setStep(0);
        if (imageInput.current) imageInput.current.value = '';
        save(emptyDraft(), false);
        setMessage(
            persistDraft(emptyDraft(), false)
                ? t(
                      '本站本机草稿已清除。已下载文件与脚本中的资料需分别删除。',
                      'Local site draft cleared. Delete downloaded files and userscript data separately.',
                  )
                : t(
                      '浏览器拒绝清除存储，请在浏览器设置中清除本站数据。',
                      'Clear this site’s data in your browser settings.',
                  ),
        );
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
                <button className="primary-action type-action" type="submit" disabled={busy}>
                    {busy ? t('识别中…', 'Reading…') : t('下一步', 'Next')}
                </button>
            )}
        </div>
    );
    function fields(items: Field[], values: Fields, personal: boolean, actions?: ReactNode) {
        return (
            <div className="mdac-fields">
                {items.map(field => (
                    <label key={field.key} className="type-label">
                        {language === 'zh' ? field.zh : field.en}
                        {field.optional ? t('（选填）', ' (optional)') : ''}
                        {field.options ? (
                            <select
                                value={values[field.key] ?? ''}
                                required={!field.optional}
                                disabled={busy}
                                onChange={event => update(field, event.target.value, personal)}
                            >
                                <option value="">{t('请选择', 'Select')}</option>
                                {field.options.map(([value, label], index) => (
                                    <option key={value + index} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                value={values[field.key] ?? ''}
                                required={!field.optional}
                                disabled={busy}
                                className="type-input"
                                type={field.type ?? 'text'}
                                maxLength={field.maxLength ?? 250}
                                autoComplete="off"
                                pattern={field.pattern}
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
                            />
                        )}
                    </label>
                ))}
                {actions}
            </div>
        );
    }
    return (
        <Subpage
            title={t('马来西亚入境卡', 'Malaysia arrival card')}
            language={language}
            onBack={onBack}
            className="mdac-page"
        >
            <SubpageBody>
                <div className="mdac-layout">
                    <section className="mdac-panel">
                        <p className="type-helper">
                            {t(
                                '免登录使用 · 护照自动识别后核对 · 官网最终提交',
                                'No sign-in · Review passport recognition · Submit on the official site',
                            )}
                        </p>
                        <p className="type-helper">
                            {t(
                                '请准备邮箱、电话、入离境日期、航班及住宿资料。航班号不能推断住宿、离境日期或联系方式。',
                                'Have your email, phone, travel dates, flight and accommodation ready. These cannot all be inferred from a flight number.',
                            )}
                        </p>
                        <ol className="mdac-steps type-meta">
                            {[
                                t('护照资料', 'Passport'),
                                t('行程与联系', 'Travel and contact'),
                                t('核对资料', 'Review'),
                            ].map((label, index) => (
                                <li key={label} aria-current={step === index ? 'step' : undefined}>
                                    {index + 1} · {label}
                                </li>
                            ))}
                        </ol>
                        {message && (
                            <p className="mdac-message type-helper" role="status">
                                {message}
                            </p>
                        )}
                        <form aria-busy={busy} onSubmit={advance} autoComplete="off">
                            {step === 0 && (
                                <>
                                    <div className="mdac-actions mdac-travelers">
                                        <label className="type-label">
                                            {t('当前旅客', 'Traveler')}
                                            <select
                                                value={traveler}
                                                disabled={busy}
                                                onChange={event => setTraveler(Number(event.target.value))}
                                            >
                                                {draft.travelers.map((person, index) => (
                                                    <option key={index} value={index}>
                                                        {person.name ||
                                                            t('旅客', 'Traveler') + ' ' + (index + 1)}
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
                                    <label className="mdac-scan type-label">
                                        {t('拍摄或上传护照资料页', 'Capture or upload the passport page')}
                                        <input
                                            ref={imageInput}
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp"
                                            capture="environment"
                                            disabled={busy}
                                            onChange={event => {
                                                const file = event.target.files?.[0];
                                                if (file) void scan(file);
                                            }}
                                        />
                                    </label>
                                    <p className="type-helper">
                                        {t(
                                            '请拍清底部两行机读码，避免反光；识别结果必须与护照原件核对。',
                                            'Include both machine-readable lines at the bottom, avoid glare, and check the result against the passport.',
                                        )}
                                    </p>
                                    {fields(personalFields, draft.travelers[traveler], true, stepActions)}
                                </>
                            )}
                            {step === 1 && fields(tripFields, draft.shared, false)}
                            {step === 2 && (
                                <>
                                    <h2 className="type-section">
                                        {t('逐位核对旅客', 'Review each traveler')}
                                    </h2>
                                    {draft.travelers.map((person, index) => (
                                        <details key={index} open={index === 0}>
                                            <summary>{person.name}</summary>
                                            <dl className="mdac-review">
                                                {personalFields.map(field => (
                                                    <div key={field.key}>
                                                        <dt>{language === 'zh' ? field.zh : field.en}</dt>
                                                        <dd>
                                                            {field.options?.find(
                                                                ([code]) => code === person[field.key],
                                                            )?.[1] ?? person[field.key]}
                                                        </dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </details>
                                    ))}
                                    <h2 className="type-section">{t('本次行程', 'This trip')}</h2>
                                    <dl className="mdac-review">
                                        {tripFields.map(field => (
                                            <div key={field.key}>
                                                <dt>{language === 'zh' ? field.zh : field.en}</dt>
                                                <dd>
                                                    {field.options?.find(
                                                        ([code]) => code === draft.shared[field.key],
                                                    )?.[1] ??
                                                        draft.shared[field.key] ??
                                                        '—'}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                    <p className="type-helper">
                                        {t(
                                            '普通手机浏览器若不支持扩展，可保留此页，对照填写官网。桌面端可在支持油猴扩展的浏览器中安装 MDAC 脚本，将导出的 JSON 内容导入，再选择旅客自动填表。每位旅客需在官网核对、完成验证并提交。',
                                            'On mobile without extension support, copy the reviewed details into the official form. ' +
                                                'On desktop, install the MDAC userscript in a compatible browser, import the exported JSON ' +
                                                'and select a traveler to fill the form. Review, verify and submit each traveler on the official site.',
                                        )}
                                    </p>
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
                                            onClick={download}
                                        >
                                            {t('导出填表资料', 'Export details')}
                                        </button>
                                        <a
                                            className="primary-action type-action"
                                            href={OFFICIAL_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {t('打开官方登记页', 'Open official registration')}
                                        </a>
                                    </div>
                                </>
                            )}
                            {step > 0 && stepActions}
                        </form>
                    </section>
                    <aside className="mdac-panel">
                        <h2 className="type-section">{t('资料保存在此浏览器', 'Details on this browser')}</h2>
                        <p className="type-helper">
                            {t(
                                '护照照片在本机识别。旅客资料不上传商城、不存入商城数据库。提交官网时由马来西亚移民局接收。',
                                'Passport images are processed locally. Traveler details are not uploaded to the store or its database. ' +
                                    'Official submissions go to Malaysian Immigration.',
                            )}
                        </p>
                        <label className="mdac-check">
                            <input
                                type="checkbox"
                                checked={remember}
                                disabled={busy}
                                onChange={event => {
                                    const keep = event.target.checked;
                                    if (persistDraft(draft, keep)) setRemember(keep);
                                    else
                                        setMessage(
                                            t('浏览器存储不可用。', 'Browser storage is unavailable.'),
                                        );
                                }}
                            />
                            {t('保留本机草稿', 'Keep a local draft')}
                        </label>
                        <p className="type-helper">
                            {t(
                                '保留后，下次可在同一浏览器继续。清除站点数据将删除草稿。',
                                'A saved draft is available in this browser. Clearing site data removes it.',
                            )}
                        </p>
                        <button className="secondary-action type-action" type="button" onClick={clear}>
                            {t('清除本机资料', 'Clear local details')}
                        </button>
                    </aside>
                </div>
            </SubpageBody>
        </Subpage>
    );
}
