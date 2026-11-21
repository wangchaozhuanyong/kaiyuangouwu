import 'reflect-metadata';

import { ForbiddenError } from '@vendure/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MdacFlightLookupShopResolver } from './mdac-flight-lookup.resolver';
import { isMdacFlightLookupConfigured, MdacFlightLookupService } from './mdac-flight-lookup.service';

const input = { arrivalDate: '2026-12-02', arrivalAirport: 'KUL', flightNumber: 'MH123' };
const ip = '192.0.2.1';
const route = {
    carrier: { iata: 'MH' },
    flightNumber: 123,
    departure: { airport: { iata: 'CAN' }, country: { code: 'CN' }, date: { local: '2026-12-01' } },
    arrival: {
        airport: { iata: 'KUL' },
        country: { code: 'MY' },
        date: { local: '2026-12-02' },
        time: { local: '03:00' },
    },
};
const throughRoute = {
    ...route,
    departure: { airport: { iata: 'FUK' }, country: { code: 'JP' } },
    segmentInfo: { numberOfStops: 1, intermediateAirports: { iata: ['CAN'] } },
};
const provider = vi.fn<typeof fetch>();

function requestUrl(call: number): URL {
    const url = provider.mock.calls[call][0];
    if (typeof url !== 'string') throw new Error('Expected an OAG URL string');
    return new URL(url);
}

function page(data: unknown[], paging: { totalCount?: number; next?: string } = {}) {
    return new Response(JSON.stringify({ data, paging: { totalCount: data.length, ...paging } }));
}

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-01T16:15:00Z'));
    vi.stubEnv('STOREFRONT_MDAC_FLIGHT_LOOKUP_ENABLED', 'true');
    vi.stubEnv('STOREFRONT_MDAC_OAG_SUBSCRIPTION_KEY', 'fixture-only');
    vi.stubGlobal('fetch', provider);
    provider.mockReset();
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('MDAC OAG lookup', () => {
    it.each([undefined, 'false'])(
        'keeps flight lookup off with a key and an activation flag of %s',
        async enabled => {
            vi.stubEnv('STOREFRONT_MDAC_FLIGHT_LOOKUP_ENABLED', enabled);
            expect(isMdacFlightLookupConfigured()).toBe(false);
            expect(await new MdacFlightLookupService().lookup(input, ip)).toEqual({
                status: 'NOT_CONFIGURED',
                flights: [],
            });
            expect(provider).not.toHaveBeenCalled();
        },
    );

    it('looks up by Malaysian arrival date rather than origin departure date, including a codeshare', async () => {
        provider.mockResolvedValueOnce(
            page([{ ...route, codeshare: { marketingFlights: [{ code: 'CZ', serviceNumber: '4321' }] } }]),
        );
        const result = await new MdacFlightLookupService().lookup(
            { ...input, flightNumber: ' cz 4321 ' },
            ip,
        );
        expect(result).toEqual({
            status: 'MATCHED',
            flights: [
                {
                    flightNumber: 'CZ4321',
                    operatingFlightNumber: 'MH123',
                    departureAirport: 'CAN',
                    arrivalAirport: 'KUL',
                    scheduledArrivalDate: '2026-12-02',
                    scheduledArrivalTime: '03:00',
                    effectiveArrivalDate: '2026-12-02',
                    effectiveArrivalTime: '03:00',
                    status: 'SCHEDULED',
                },
            ],
        });
        const request = requestUrl(0);
        expect(request.origin).toBe('https://api.oag.com');
        expect(request.searchParams.get('ArrivalDateTime')).toBe('2026-12-01/2026-12-03');
        expect(request.searchParams.get('ArrivalCountryCode')).toBe('MY');
        expect(request.searchParams.get('FlightNumber')).toBe('4321');
        expect(request.searchParams.get('Content')).toBe('Status');
        expect(request.searchParams.get('Limit')).toBe('10');
    });

    it('marks a scheduled flight changed to a different day and accepts a search on the corrected day', async () => {
        const delayed = {
            ...route,
            statusDetails: [
                {
                    state: 'Scheduled',
                    arrival: { estimatedTime: { onGround: { local: '2026-12-03T00:25:00' } } },
                },
            ],
        };
        provider.mockResolvedValueOnce(page([delayed])).mockResolvedValueOnce(page([delayed]));
        const service = new MdacFlightLookupService();
        const original = await service.lookup(input, ip);
        expect(original.flights[0]).toMatchObject({
            status: 'ARRIVAL_CHANGED',
            effectiveArrivalTime: '00:25',
        });
        const corrected = await service.lookup({ ...input, arrivalDate: '2026-12-03' }, ip);
        expect(corrected.flights[0]).toMatchObject({
            status: 'SCHEDULED',
            effectiveArrivalDate: '2026-12-03',
        });
    });

    it('preserves a leading zero in the ticket designator while comparing the numeric provider field', async () => {
        provider.mockResolvedValueOnce(page([route]));
        const result = await new MdacFlightLookupService().lookup({ ...input, flightNumber: 'mh 0123' }, ip);
        expect(result.flights[0]?.flightNumber).toBe('MH0123');
        expect(requestUrl(0).searchParams.get('FlightNumber')).toBe('123');
    });

    it.each([
        [{ state: 'Canceled' }, 'CANCELLED', 'KUL'],
        [{ irregularOperationType: 'Diversion', arrival: { airport: { iata: 'PEN' } } }, 'DIVERTED', 'PEN'],
    ])('identifies abnormal flight status %j', async (upstreamStatus, status, arrivalAirport) => {
        provider.mockResolvedValueOnce(page([{ ...route, statusDetails: [upstreamStatus] }]));
        const result = await new MdacFlightLookupService().lookup(input, ip);
        expect(result).toMatchObject({ status: 'MATCHED', flights: [{ status, arrivalAirport }] });
    });

    it.each([
        [true, 'NO_MATCH'],
        [false, 'UNAVAILABLE'],
    ])(
        'reports no matching record only when the airport/date has schedule coverage (%s)',
        async (coverage, status) => {
            provider.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page(coverage ? [route] : []));
            const result = await new MdacFlightLookupService().lookup(input, ip);
            expect(result).toEqual({ status, flights: [] });
            const coverageQuery = requestUrl(1);
            expect(coverageQuery.searchParams.get('ArrivalDateTime')).toBe(input.arrivalDate);
            expect(coverageQuery.searchParams.has('FlightNumber')).toBe(false);
        },
    );

    it('keeps the host and original filters while following a cursor', async () => {
        provider
            .mockResolvedValueOnce(
                page([], { totalCount: 1, next: 'https://different.invalid/?After=page2' }),
            )
            .mockResolvedValueOnce(page([route]));
        const result = await new MdacFlightLookupService().lookup(input, ip);
        expect(result.status).toBe('MATCHED');
        const next = requestUrl(1);
        expect(next.hostname).toBe('api.oag.com');
        expect(next.searchParams.get('ArrivalAirport')).toBe('KUL');
        expect(next.searchParams.get('After')).toBe('page2');
    });

    it('does not validate a connecting flight that departed from within Malaysia', async () => {
        provider
            .mockResolvedValueOnce(
                page([{ ...route, departure: { airport: { iata: 'PEN' }, country: { code: 'MY' } } }]),
            )
            .mockResolvedValueOnce(page([route]));
        expect((await new MdacFlightLookupService().lookup(input, ip)).status).toBe('NO_MATCH');
    });

    it('keeps the actual inbound leg when a through-flight record precedes it on another page', async () => {
        provider
            .mockResolvedValueOnce(
                page([throughRoute], { totalCount: 2, next: 'https://api.oag.com/?After=page2' }),
            )
            .mockResolvedValueOnce(
                page([{ ...route, segmentInfo: { numberOfStops: 0, intermediateAirports: { iata: [] } } }], {
                    totalCount: 2,
                }),
            );
        const result = await new MdacFlightLookupService().lookup(input, ip);
        expect(result.status).toBe('MATCHED');
        expect(result.flights.map(flight => flight.departureAirport)).toEqual(['CAN']);
    });

    it('reports unavailable when only the through-flight record is returned for the selected day', async () => {
        provider.mockResolvedValueOnce(page([throughRoute])).mockResolvedValueOnce(page([route]));
        expect(await new MdacFlightLookupService().lookup(input, ip)).toEqual({
            status: 'UNAVAILABLE',
            flights: [],
        });
        expect(provider).toHaveBeenCalledTimes(1);
    });

    it('can still rule out a match when the through-flight record is for an adjacent day', async () => {
        const adjacent = {
            ...throughRoute,
            arrival: { ...throughRoute.arrival, date: { local: '2026-12-03' } },
        };
        provider.mockResolvedValueOnce(page([adjacent])).mockResolvedValueOnce(page([route]));
        expect(await new MdacFlightLookupService().lookup(input, ip)).toEqual({
            status: 'NO_MATCH',
            flights: [],
        });
    });

    it.each([
        () => page([], { totalCount: 100 }),
        () => page([null]),
        () => new Response('{}', { status: 429 }),
    ])('returns unavailable for truncated, malformed, or blocked upstream data', async upstream => {
        provider.mockResolvedValueOnce(upstream());
        expect(await new MdacFlightLookupService().lookup(input, ip)).toEqual({
            status: 'UNAVAILABLE',
            flights: [],
        });
    });

    it('validates calendar dates, airport codes and the 30-day local-date window without a provider call', async () => {
        const service = new MdacFlightLookupService();
        for (const change of [
            { arrivalDate: '2026-12-01' },
            { arrivalDate: '2026-12-32' },
            { arrivalDate: '2027-01-02' },
            { arrivalAirport: 'KUL,SIN' },
            { flightNumber: 'MH0000' },
        ]) {
            expect((await service.lookup({ ...input, ...change }, ip)).status).toBe('INVALID_INPUT');
        }
        vi.stubEnv('STOREFRONT_MDAC_OAG_SUBSCRIPTION_KEY', '');
        expect((await service.lookup(input, ip)).status).toBe('NOT_CONFIGURED');
        expect(provider).not.toHaveBeenCalled();
    });

    it('bounds the requests each caller can send to the provider', async () => {
        const service = new MdacFlightLookupService();
        provider.mockImplementation(() => Promise.resolve(page([route])));
        for (let call = 0; call < 10; call++)
            expect((await service.lookup(input, ip)).status).toBe('MATCHED');
        expect((await service.lookup(input, ip)).status).toBe('UNAVAILABLE');
        expect(provider).toHaveBeenCalledTimes(10);
    });

    it('requires the existing published store policy before querying the provider', async () => {
        const service = { lookup: vi.fn() };
        const resolver = new MdacFlightLookupShopResolver(
            { canLookupMdacFlights: vi.fn().mockResolvedValue(false) } as never,
            service as never,
        );
        await expect(
            resolver.mdacFlightLookup({ req: { ip } } as never, input.arrivalDate, 'KUL', 'MH123'),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(service.lookup).not.toHaveBeenCalled();
    });
});
