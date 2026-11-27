// organize-imports-ignore -- Keep ESLint type import grouping.
import type { StorefrontLanguage } from '../../types';
import { BedDouble, Globe2, Mail, PenLine, Plane, Route } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';

import { type MdacFlight } from './flight-lookup';
import { type MdacHotel } from './hotel-picker';
import { MdacSelect } from './mdac-select';
import {
    AIR_TRAVEL,
    contactFields,
    lodgingFields,
    personalFields,
    travelFields,
    type Field,
    type Fields,
} from './model';

interface MdacReviewBoardProps {
    language: StorefrontLanguage;
    travelers: Fields[];
    traveler: number;
    onTravelerChange: (index: number) => void;
    onEditTraveler: () => void;
    trip: Fields;
    reviewField: (field: Field) => string;
    suggestedHotel: MdacHotel | null;
    hotelName?: string;
    verifiedFlight: MdacFlight | null;
    onEditTrip: (fieldKey: string) => void;
}

const [passportName, passportNumber, ...passportDetails] = personalFields;
const tripDates = travelFields.filter(field => field.type === 'date');
const transportDetails = travelFields.filter(field => field.type !== 'date');
const [stayType, streetAddress, extraAddress, ...locationFields] = lodgingFields;
const [email, callingCode, phone] = contactFields;

export function MdacReviewBoard({
    language,
    travelers,
    traveler,
    onTravelerChange,
    onEditTraveler,
    trip,
    reviewField,
    suggestedHotel,
    hotelName,
    verifiedFlight,
    onEditTrip,
}: MdacReviewBoardProps) {
    const id = useId();
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const person = travelers[traveler];
    const byAir = trip.trvlMode === AIR_TRAVEL;
    const directoryName = (suggestedHotel?.name ?? hotelName)?.trim();
    const address = reviewField(streetAddress);
    // Only a known directory name can be separated from its matching address prefix.
    const hasNamePrefix = Boolean(
        directoryName && address.toLowerCase().startsWith(directoryName.toLowerCase()),
    );
    const street =
        hasNamePrefix && directoryName
            ? (address.slice(directoryName.length).match(/^\s*[,，]\s*(.+)$/u)?.[1] ?? address)
            : address;
    const showHotelName = directoryName && directoryName.toLowerCase() !== address.trim().toLowerCase();
    const indices = travelers.map((_, index) => index);
    const visible = indices.filter(index => index < 2 || index === Math.max(2, traveler));
    const otherTravelers = indices.filter(index => !visible.includes(index));
    const travelerLabel = (index: number) => t(`旅客 ${index + 1}`, `Traveler ${index + 1}`);

    function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const position = visible.indexOf(index);
        const destination = {
            ArrowLeft: (position + visible.length - 1) % visible.length,
            ArrowRight: (position + 1) % visible.length,
            Home: 0,
            End: visible.length - 1,
        }[event.key];
        if (destination === undefined) return;
        event.preventDefault();
        const next = visible[destination];
        document.getElementById(`${id}-tab-${next}`)?.focus();
        onTravelerChange(next);
    }

    function personalValue(field: Field) {
        const raw = person[field.key];
        if ((field.key === 'nationality' || field.key === 'pob') && raw === 'CHN') return t('中国', 'China');
        if (field.key === 'sex' && raw === '1') return t('男', 'Male');
        if (field.key === 'sex' && raw === '2') return t('女', 'Female');
        return field.options?.find(([code]) => code === raw)?.[1] ?? (raw || '—');
    }

    function fact(field: Field, value = reviewField(field), label = t(field.zh, field.en)) {
        return (
            <div key={field.key} data-review-field={field.key}>
                <dt className="type-helper">{label}</dt>
                <dd className="type-body">
                    {field.type === 'date' && value !== '—' ? <time dateTime={value}>{value}</time> : value}
                </dd>
            </div>
        );
    }

    function groupHeading(title: string, Icon: typeof Plane, editField: Field) {
        return (
            <div className="mdac-review-group-heading">
                <h3 className="type-card">
                    <Icon size={18} aria-hidden="true" />
                    {title}
                </h3>
                <button
                    type="button"
                    className="mdac-link type-action"
                    aria-label={t('修改' + title, 'Edit ' + title)}
                    onClick={() => onEditTrip(editField.key)}
                >
                    {t('修改', 'Edit')}
                </button>
            </div>
        );
    }

    return (
        <div className="mdac-review-board">
            <section className="mdac-review-column" aria-labelledby={id + '-people'}>
                <div className="mdac-review-heading">
                    <h2 className="type-section" id={id + '-people'}>
                        {t('同行旅客', 'Travelers')}
                    </h2>
                    <span className="type-helper">
                        {t(
                            `共 ${travelers.length} 位`,
                            `${travelers.length} ${travelers.length === 1 ? 'traveler' : 'travelers'}`,
                        )}
                    </span>
                </div>
                <div className="mdac-review-panel mdac-review-travelers">
                    {travelers.length > 1 && (
                        <div className="mdac-review-picker">
                            <div
                                className="mdac-review-tabs"
                                role="tablist"
                                aria-label={t('选择旅客', 'Choose a traveler')}
                            >
                                {visible.map(index => (
                                    <button
                                        key={index}
                                        type="button"
                                        className="mdac-review-tab type-action"
                                        role="tab"
                                        id={`${id}-tab-${index}`}
                                        aria-controls={id + '-person'}
                                        aria-selected={traveler === index}
                                        tabIndex={traveler === index ? 0 : -1}
                                        aria-label={travelerLabel(index) + ' · ' + travelers[index].name}
                                        onKeyDown={e => moveTab(e, index)}
                                        onClick={() => onTravelerChange(index)}
                                    >
                                        <span
                                            className="mdac-review-tab-number type-helper"
                                            aria-hidden="true"
                                        >
                                            {String(index + 1).padStart(2, '0')}
                                        </span>
                                        <span className="mdac-review-tab-name" title={travelers[index].name}>
                                            {travelers[index].name}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            {otherTravelers.length > 0 && (
                                <div className="mdac-review-more">
                                    <label htmlFor={id + '-more'} className="visually-hidden">
                                        {t('更多旅客', 'More travelers')}
                                    </label>
                                    <MdacSelect
                                        id={id + '-more'}
                                        title={t('更多旅客', 'More travelers')}
                                        language={language}
                                        placeholder={t('更多', 'More')}
                                        value=""
                                        options={otherTravelers.map(i => [
                                            String(i),
                                            travelerLabel(i) + ' · ' + travelers[i].name,
                                        ])}
                                        onChange={value => {
                                            if (value !== '') onTravelerChange(Number(value));
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    <div
                        id={id + '-person'}
                        role={travelers.length > 1 ? 'tabpanel' : undefined}
                        aria-labelledby={travelers.length > 1 ? `${id}-tab-${traveler}` : undefined}
                    >
                        <div className="mdac-review-identity">
                            <dl className="mdac-review-passport">
                                {fact(passportName, personalValue(passportName))}
                                {fact(passportNumber, personalValue(passportNumber))}
                            </dl>
                            <Globe2 size={76} className="mdac-review-globe" aria-hidden="true" />
                        </div>
                        <dl className="mdac-review-person-fields">
                            {passportDetails.map(field => fact(field, personalValue(field)))}
                        </dl>
                        <div className="mdac-review-editrow">
                            <button type="button" className="mdac-link type-action" onClick={onEditTraveler}>
                                <PenLine size={15} aria-hidden="true" />
                                {t('修改旅客资料', 'Edit traveler')}
                            </button>
                        </div>
                    </div>
                </div>
            </section>
            <section className="mdac-review-column" aria-labelledby={id + '-trip'}>
                <div className="mdac-review-heading">
                    <h2 className="type-section" id={id + '-trip'}>
                        {t('本次行程', 'This trip')}
                    </h2>
                    {travelers.length > 1 && (
                        <span className="type-helper">{t('同行旅客共用', 'Shared by all travelers')}</span>
                    )}
                </div>
                <div className="mdac-review-panel mdac-review-trip">
                    <section className="mdac-review-group">
                        {groupHeading(
                            byAir
                                ? t('航班与日期', 'Flight and dates')
                                : t('交通与日期', 'Transport and dates'),
                            byAir ? Plane : Route,
                            tripDates[0],
                        )}
                        <dl className="mdac-review-dates">{tripDates.map(field => fact(field))}</dl>
                        <dl className="mdac-review-facts mdac-review-transport">
                            {transportDetails.map(field =>
                                field.key === 'vesselNm'
                                    ? fact(
                                          field,
                                          reviewField(field),
                                          byAir
                                              ? t('航班号', 'Flight number')
                                              : t('交通工具编号', 'Transport number'),
                                      )
                                    : fact(field),
                            )}
                        </dl>
                        {byAir && verifiedFlight && (
                            <p className="mdac-review-verified type-helper">
                                {t('已核验抵达航班', 'Verified arrival flight')} ·{' '}
                                {verifiedFlight.departureAirport} → {verifiedFlight.arrivalAirport} ·{' '}
                                {verifiedFlight.effectiveArrivalDate} {verifiedFlight.effectiveArrivalTime}
                            </p>
                        )}
                    </section>
                    <section className="mdac-review-group">
                        {groupHeading(
                            t('在马来西亚的住宿', 'Accommodation in Malaysia'),
                            BedDouble,
                            stayType,
                        )}
                        {showHotelName && <p className="mdac-review-hotel type-card">{directoryName}</p>}
                        <dl className="mdac-review-address">{fact(streetAddress, street)}</dl>
                        <dl className="mdac-review-facts mdac-review-location">
                            {locationFields.map(field => fact(field))}
                        </dl>
                        <dl className="mdac-review-address mdac-review-stay-details">
                            {fact(stayType)}
                            {fact(extraAddress, trip[extraAddress.key] || t('未填写', 'Not provided'))}
                        </dl>
                        {suggestedHotel && (
                            <p className="mdac-review-advice type-helper">
                                {t(
                                    '酒店地址为自动带入，请核对是否为实际住宿。',
                                    'A hotel address was suggested. Check that it is where you will stay.',
                                )}
                            </p>
                        )}
                    </section>
                    <section className="mdac-review-group">
                        {groupHeading(t('联系方式', 'Contact details'), Mail, email)}
                        <dl className="mdac-review-facts mdac-review-contact">
                            {fact(email)}
                            <div>
                                <dt className="type-helper">
                                    {t(phone.zh, phone.en)} ·{' '}
                                    <span data-review-field="region">{reviewField(callingCode)}</span>
                                </dt>
                                <dd data-review-field="mobile" className="type-body">
                                    {reviewField(phone)}
                                </dd>
                            </div>
                        </dl>
                    </section>
                </div>
            </section>
        </div>
    );
}
