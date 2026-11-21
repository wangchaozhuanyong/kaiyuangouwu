// organize-imports-ignore -- Keep ESLint type import grouping.
import type { StorefrontLanguage } from '../../types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { createRequestSignal, SHOP_API_QUERY_TIMEOUT_MS } from '../../api/helpers';

export interface MdacHotel {
    id: string;
    name: string;
    address: string;
    address2?: string;
    state: '10' | '14';
    city: string;
    postcode: string;
    source: string;
    registry: string;
}

function normalizeHotelSearch(text: string) {
    return text
        .normalize('NFKD')
        .replace(/\p{Mark}/gu, '')
        .toLowerCase()
        .replace(/['’]/gu, '')
        .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
        .trim();
}

function searchHotels(directory: MdacHotel[], search: string) {
    const terms = search.split(' ');
    const matches = directory.flatMap(hotel => {
        const name = normalizeHotelSearch(hotel.name);
        const address = normalizeHotelSearch(
            [hotel.address, hotel.address2, hotel.city, hotel.postcode].join(' '),
        );
        if (!terms.every(term => name.includes(term) || address.includes(term))) return [];

        let rank = 0;
        if (name === search || hotel.postcode === search) rank = 3;
        else if (name.includes(search)) rank = 2;
        else if (terms.every(term => name.includes(term))) rank = 1;
        return [{ hotel, rank }];
    });
    return matches
        .sort((left, right) => right.rank - left.rank)
        .slice(0, 8)
        .map(match => match.hotel);
}

export function MdacHotelPicker({
    language,
    suggestedName,
    onSuggest,
    onSelect,
}: {
    language: StorefrontLanguage;
    suggestedName?: string;
    onSuggest?: (hotel: MdacHotel) => void;
    onSelect: (hotel: MdacHotel) => void;
}) {
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const id = useId();
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState('');
    const search = normalizeHotelSearch(query);
    const ready = search.replaceAll(' ', '').length >= 2;
    const needsDirectory = ready || Boolean(onSuggest);

    const directoryQuery = useQuery({
        // The shipped bilingual directory is identical across shops and has no traveler data.
        queryKey: ['mdac-hotel-directory', 1],
        enabled: needsDirectory,
        queryFn: async ({ signal }) => {
            const request = createRequestSignal(signal, SHOP_API_QUERY_TIMEOUT_MS);
            try {
                const response = await fetch('/mdac/hotels.json', { signal: request.signal });
                if (!response.ok) throw Error('Hotel directory unavailable');
                const hotels: unknown = await response.json();
                if (!Array.isArray(hotels)) throw Error('Invalid hotel directory');
                return hotels as MdacHotel[];
            } finally {
                request.cleanup();
            }
        },
    });
    const directory = directoryQuery.data;
    useEffect(() => {
        if (onSuggest && directory?.length) {
            onSuggest(directory[Math.floor(Math.random() * directory.length)]);
        }
    }, [directory, onSuggest]);

    const matches = ready && directory ? searchHotels(directory, search) : undefined;

    return (
        <div className="mdac-hotel-picker">
            <div className="mdac-hotel-heading">
                <label htmlFor={id} className="type-label">
                    {t('查找已预订的酒店', 'Find your booked hotel')}
                </label>
                <p className="type-helper">
                    {t('可直接手填实际住宿地址。', 'Or enter your address manually.')}
                </p>
            </div>
            <input
                id={id}
                type="search"
                placeholder={t('酒店英文名、地址、城市或邮编', 'Hotel name, address, city or postcode')}
                maxLength={100}
                value={query}
                onKeyDown={event => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
                }}
                onChange={event => {
                    setQuery(event.target.value);
                    setSelected('');
                }}
            />
            {selected && (
                <p className="type-helper" role="status">
                    {t('已填入', 'Filled from')} {selected}
                </p>
            )}
            {suggestedName && (
                <p className="type-helper" role="status">
                    {t('自动带入的参考酒店', 'Suggested hotel')} · {suggestedName}
                </p>
            )}
            {needsDirectory &&
                !selected &&
                !directory &&
                (directoryQuery.isError ? (
                    <div className="mdac-hotel-status">
                        <p className="type-helper" role="status">
                            {t(
                                '酒店目录暂不可用，可手填地址。',
                                'The hotel directory is unavailable. You can enter the address manually.',
                            )}
                        </p>
                        <button
                            type="button"
                            className="secondary-action type-action"
                            onClick={() => void directoryQuery.refetch({ cancelRefetch: false })}
                        >
                            {t('重试', 'Retry')}
                        </button>
                    </div>
                ) : (
                    <p className="type-helper" role="status">
                        {t('正在加载酒店目录…', 'Loading hotel directory…')}
                    </p>
                ))}
            {needsDirectory && !ready && directory?.length === 0 && (
                <p className="type-helper" role="status">
                    {t(
                        '酒店目录暂无记录，可手填实际住宿地址。',
                        'The hotel directory is empty. Enter your accommodation address manually.',
                    )}
                </p>
            )}
            {matches &&
                !selected &&
                (matches.length === 0 ? (
                    <p className="type-helper" role="status">
                        {t(
                            '未找到酒店，可手填实际住宿地址。',
                            'No hotel found. Enter your accommodation address manually.',
                        )}
                    </p>
                ) : (
                    <ul className="mdac-hotel-results">
                        {matches.map(hotel => (
                            <li key={hotel.id}>
                                <button
                                    type="button"
                                    className="secondary-action type-label"
                                    onClick={() => {
                                        onSelect(hotel);
                                        setSelected(hotel.name);
                                        setQuery('');
                                    }}
                                >
                                    <strong>{hotel.name}</strong>
                                    <span className="type-helper">
                                        {hotel.address}, {hotel.city} {hotel.postcode}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ))}
            <p className="type-helper">
                <a href="/mdac/hotel-directory-sources.txt" target="_blank" rel="noreferrer">
                    {t('酒店目录来源', 'Hotel directory sources')}
                </a>
                {' · © OpenStreetMap contributors, Overture Maps Foundation'}
            </p>
        </div>
    );
}
