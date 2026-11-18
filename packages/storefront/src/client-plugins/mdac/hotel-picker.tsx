// organize-imports-ignore -- Keep ESLint type import grouping.
import type { StorefrontLanguage } from '../../types';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

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

export function MdacHotelPicker({
    language,
    onSelect,
}: {
    language: StorefrontLanguage;
    onSelect: (hotel: MdacHotel) => void;
}) {
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const id = useId();
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState('');
    const search = query.trim().toLowerCase();
    const ready = search.length >= 2;

    const directoryQuery = useQuery({
        // The shipped bilingual directory is identical across shops and has no traveler data.
        queryKey: ['mdac-hotel-directory', 1],
        enabled: ready,
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

    const matches = ready
        ? directory
              ?.filter(hotel =>
                  `${hotel.name} ${hotel.address} ${hotel.city} ${hotel.postcode}`
                      .toLowerCase()
                      .includes(search),
              )
              .slice(0, 8)
        : undefined;

    return (
        <div className="mdac-hotel-picker">
            <label htmlFor={id} className="type-label">
                {t('查找已预订的酒店', 'Find your booked hotel')}
            </label>
            <input
                id={id}
                type="search"
                placeholder={t('酒店英文名或邮编', 'Hotel name or postcode')}
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
            {ready &&
                !selected &&
                (directoryQuery.isError && !directory ? (
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
                ) : matches === undefined || matches.length === 0 ? (
                    <p className="type-helper" role="status">
                        {matches === undefined
                            ? t('正在加载酒店目录…', 'Loading hotel directory…')
                            : t(
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
