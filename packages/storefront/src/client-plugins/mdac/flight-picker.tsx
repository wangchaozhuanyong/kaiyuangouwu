import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useId, useState } from 'react';
import type { StorefrontLanguage } from '../../types';

import { storefrontQueryKeys } from '../../query-client';

import {
    isTicketFlightNumber,
    type MdacFlight,
    type MdacFlightLookup,
    type MdacFlightSearch,
} from './flight-lookup';
import { isIsoDate, malaysiaToday } from './model';

export interface MdacFlightService {
    marketKey: string;
    lookup: MdacFlightLookup;
}

const airports = [
    ['KUL', '吉隆坡', 'Kuala Lumpur'],
    ['PEN', '槟城', 'Penang'],
    ['BKI', '亚庇', 'Kota Kinabalu'],
    ['JHB', '新山', 'Johor Bahru'],
    ['KCH', '古晋', 'Kuching'],
    ['LGK', '兰卡威', 'Langkawi'],
    ['SZB', '梳邦', 'Subang'],
] as const;

function matchLabel(flight: MdacFlight) {
    return !flight.operatingFlightNumber || flight.flightNumber === flight.operatingFlightNumber
        ? flight.flightNumber
        : `${flight.flightNumber} / ${flight.operatingFlightNumber}`;
}

export function MdacFlightPicker({
    language,
    service,
    input,
    onAirportChange,
    selected,
    onSelect,
    numberField,
}: {
    language: StorefrontLanguage;
    service: MdacFlightService;
    input: MdacFlightSearch;
    onAirportChange: (airport: string) => void;
    selected: MdacFlight | null;
    onSelect: (flight: MdacFlight | null) => void;
    numberField: React.ReactNode;
}) {
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const id = useId();
    const [submitted, setSubmitted] = useState<MdacFlightSearch | null>(null);
    const ready =
        isIsoDate(input.arrivalDate) &&
        input.arrivalDate >= malaysiaToday() &&
        /^[A-Z]{3}$/u.test(input.arrivalAirport) &&
        isTicketFlightNumber(input.flightNumber);
    const active =
        submitted?.arrivalDate === input.arrivalDate &&
        submitted.arrivalAirport === input.arrivalAirport &&
        submitted.flightNumber === input.flightNumber;
    const query = useQuery({
        queryKey: storefrontQueryKeys.mdacFlights(service.marketKey, language, input),
        queryFn: ({ signal }) => service.lookup(input, signal),
        enabled: active && ready,
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    const result = active && !query.isFetching && !query.isError ? query.data : undefined;
    function check() {
        onSelect(null);
        if (active) void query.refetch({ cancelRefetch: false });
        else setSubmitted(input);
    }
    let message = '';
    if (active && query.isFetching) {
        message = t('正在查询抵达航班…', 'Looking up arriving flights…');
    } else if (
        (active && query.isError) ||
        result?.status === 'UNAVAILABLE' ||
        result?.status === 'NOT_CONFIGURED'
    ) {
        message = t(
            '暂时无法核验航班，可保留草稿后重试。',
            'Flight verification is temporarily unavailable. Save your draft and try again.',
        );
    } else if (result?.status === 'NO_MATCH') {
        message = t(
            '所选日期和机场未找到该航班，请核对机票。',
            'No match for this arrival date and airport. Check your ticket.',
        );
    } else if (result?.status === 'INVALID_INPUT') {
        message = t(
            '请输入有效的机场和航班号。航班查询支持今天至未来 30 天。',
            'Check the airport and flight number. Lookup is available today through the next 30 days.',
        );
    }
    return (
        <section className="mdac-flight-picker" aria-labelledby={id + '-heading'}>
            <h3 id={id + '-heading'} className="type-card">
                {t('核验抵达航班', 'Verify arrival flight')}
            </h3>
            <p className="type-helper">
                {t(
                    '请按实际抵马航段填写。查询会发送抵达日期、机场和航班号。',
                    'Use the flight leg that enters Malaysia. The lookup sends the arrival date, airport and flight number.',
                )}
            </p>
            <div className="mdac-fields">
                <div className="mdac-field">
                    <div className="mdac-field-heading">
                        <label htmlFor={id} className="type-label">
                            {t('抵达机场', 'Arrival airport')}
                        </label>
                    </div>
                    <input
                        id={id}
                        className="type-input"
                        list={id + '-airports'}
                        placeholder={t('机场代码，如 KUL', 'Airport code, e.g. KUL')}
                        maxLength={3}
                        pattern="[A-Z]{3}"
                        value={input.arrivalAirport}
                        autoComplete="off"
                        required
                        onChange={event => onAirportChange(event.currentTarget.value.toUpperCase())}
                    />
                    <datalist id={id + '-airports'}>
                        {airports.map(([code, zh, en]) => (
                            <option value={code} key={code}>
                                {t(zh, en)}
                            </option>
                        ))}
                    </datalist>
                </div>
                {numberField}
            </div>
            <button
                type="button"
                className="secondary-action type-action mdac-flight-search"
                disabled={!ready || (active && query.isFetching)}
                onClick={check}
            >
                <Search size={16} aria-hidden="true" />
                {selected ? t('重新核验', 'Check again') : t('查找航班', 'Find flight')}
            </button>
            {message && (
                <p className="type-helper" role="status">
                    {message}
                </p>
            )}
            {selected && (
                <p className="mdac-flight-confirmed type-label" role="status">
                    <Check size={16} aria-hidden="true" />
                    <span>
                        {t('已核验', 'Verified')} · {matchLabel(selected)}
                        <span className="type-helper mdac-flight-when">
                            {selected.departureAirport} → {selected.arrivalAirport}
                            {' · '}
                            {selected.effectiveArrivalDate} {selected.effectiveArrivalTime}
                        </span>
                    </span>
                </p>
            )}
            {!selected && result?.status === 'MATCHED' && (
                <ul className="mdac-flight-results">
                    {result.flights.map(flight => {
                        const details = `${flight.departureAirport} → ${flight.arrivalAirport} · ${flight.effectiveArrivalDate} ${flight.effectiveArrivalTime}`;
                        const key = `${flight.operatingFlightNumber}-${flight.departureAirport}-${flight.scheduledArrivalDate}-${flight.scheduledArrivalTime}`;
                        const state =
                            flight.status === 'CANCELLED'
                                ? t('航班已取消', 'Flight cancelled')
                                : flight.status === 'DIVERTED'
                                  ? t('已改降，请核对抵达机场', 'Flight diverted. Check the arrival airport.')
                                  : t(
                                        '抵达日期已变更，请核对机票',
                                        'Arrival date changed. Check your itinerary.',
                                    );
                        return (
                            <li key={key}>
                                {flight.status === 'SCHEDULED' ? (
                                    <button
                                        type="button"
                                        className="secondary-action type-label"
                                        onClick={() => onSelect(flight)}
                                    >
                                        <strong>{matchLabel(flight)}</strong>
                                        <span className="type-helper">{details}</span>
                                    </button>
                                ) : (
                                    <p className="type-helper">
                                        <strong>
                                            {matchLabel(flight)} · {state}
                                        </strong>
                                        <br />
                                        {details}
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
