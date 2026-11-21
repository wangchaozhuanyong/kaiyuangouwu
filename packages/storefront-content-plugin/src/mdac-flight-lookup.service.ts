import { Injectable } from '@nestjs/common';

const oagEndpoint = 'https://api.oag.com/flight-instances/';
const dayMs = 86_400_000;
const minuteMs = 60_000;
const malaysiaOffset = 8 * 60 * minuteMs;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const airportPattern = /^[A-Z]{3}$/;
const flightPattern = /^([A-Z][A-Z0-9]|[0-9][A-Z])([0-9]{1,4})([A-Z]?)$/;
const passengerServiceTypes = 'J,S,G,B,C,Q,R,L';

type LookupStatus = 'MATCHED' | 'NO_MATCH' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'INVALID_INPUT';
type FlightStatus = 'SCHEDULED' | 'CANCELLED' | 'ARRIVAL_CHANGED' | 'DIVERTED';

interface FlightLookupInput {
    arrivalDate: string;
    arrivalAirport: string;
    flightNumber: string;
}

interface MdacFlight {
    flightNumber: string;
    operatingFlightNumber: string | null;
    departureAirport: string;
    arrivalAirport: string;
    scheduledArrivalDate: string;
    scheduledArrivalTime: string;
    effectiveArrivalDate: string;
    effectiveArrivalTime: string;
    status: FlightStatus;
}

export interface MdacFlightLookupResult {
    status: LookupStatus;
    flights: MdacFlight[];
}

interface OagFlightDesignator {
    code?: string;
    carrierCode?: { iata?: string };
    serviceNumber?: string | number;
    suffix?: string;
}

interface OagAirport {
    iata?: string;
}

interface OagArrivalStatus {
    airport?: OagAirport;
    actualTime?: { onGround?: { local?: string }; inGate?: { local?: string } };
    estimatedTime?: { onGround?: { local?: string }; inGate?: { local?: string } };
}

interface OagFlight {
    carrier: { iata?: string };
    flightNumber: number;
    serviceSuffix?: string;
    departure: { airport: OagAirport; country: { code: string } };
    arrival: {
        airport: OagAirport;
        country: { code: string };
        date: { local: string };
        time: { local: string };
    };
    segmentInfo?: { numberOfStops?: number };
    codeshare?: { operatingFlight?: OagFlightDesignator; marketingFlights?: OagFlightDesignator[] };
    statusDetails?: Array<{
        state?: string;
        updatedAt?: string;
        irregularOperationType?: string;
        diversionAirport?: OagAirport;
        arrival?: OagArrivalStatus;
    }>;
}

interface OagPage {
    data: OagFlight[];
    paging: { totalCount?: number; totalPages?: number; next?: string | null };
}

function subscriptionKey() {
    if (process.env.STOREFRONT_MDAC_FLIGHT_LOOKUP_ENABLED !== 'true') return;
    return process.env.STOREFRONT_MDAC_OAG_SUBSCRIPTION_KEY?.trim();
}

export function isMdacFlightLookupConfigured(): boolean {
    return Boolean(subscriptionKey());
}

function dayLabel(time: number) {
    return new Date(time).toISOString().slice(0, 10);
}

function flightDesignator(code?: string, number?: string | number, suffix?: string) {
    if (!code || !number) return;
    const match = flightPattern.exec(code + number + (suffix ?? ''));
    return match && Number(match[2]) > 0 ? match[1] + Number(match[2]) + match[3] : undefined;
}

function parseFlight(
    flight: OagFlight,
    input: FlightLookupInput,
    requestedDesignator: string,
): MdacFlight | 'THROUGH_FLIGHT' | undefined {
    const designator = flightDesignator(flight.carrier?.iata, flight.flightNumber, flight.serviceSuffix);
    const operating = flight.codeshare?.operatingFlight;
    const operatingDesignator = flightDesignator(
        operating?.code ?? operating?.carrierCode?.iata,
        operating?.serviceNumber,
        operating?.suffix,
    );
    if (!designator) throw new Error('Invalid OAG flight designator');
    const marketing = flight.codeshare?.marketingFlights ?? [];
    if (
        designator !== requestedDesignator &&
        operatingDesignator !== requestedDesignator &&
        !marketing.some(
            item =>
                flightDesignator(item.code ?? item.carrierCode?.iata, item.serviceNumber, item.suffix) ===
                requestedDesignator,
        )
    ) {
        return;
    }
    const scheduledDate = flight.arrival?.date?.local;
    const scheduledTime = flight.arrival?.time?.local?.slice(0, 5);
    const scheduledAirport = flight.arrival?.airport?.iata;
    const origin = flight.departure?.airport?.iata;
    const originCountry = flight.departure?.country?.code;
    if (originCountry === 'MY') return;
    if (
        !scheduledDate ||
        !datePattern.test(scheduledDate) ||
        !scheduledTime ||
        !timePattern.test(scheduledTime) ||
        !scheduledAirport ||
        !airportPattern.test(scheduledAirport) ||
        !origin ||
        !airportPattern.test(origin) ||
        !originCountry
    ) {
        throw new Error('Incomplete OAG flight times or airports');
    }
    // The provider documents statusDetails[0] as the active record. Sort when
    // multiple revisions carry valid updatedAt timestamps.
    const statuses = flight.statusDetails ?? [];
    const status = [...statuses].sort(
        (a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0),
    )[0];
    const arrival = status?.arrival;
    const actualAirport = status?.diversionAirport?.iata ?? arrival?.airport?.iata ?? scheduledAirport;
    if (scheduledAirport !== input.arrivalAirport && actualAirport !== input.arrivalAirport) return;
    if (
        flight.arrival.country?.code !== 'MY' &&
        !status?.diversionAirport &&
        actualAirport === scheduledAirport
    ) {
        throw new Error('OAG arrival country does not match query');
    }

    const localArrival =
        arrival?.actualTime?.onGround?.local ??
        arrival?.actualTime?.inGate?.local ??
        arrival?.estimatedTime?.onGround?.local ??
        arrival?.estimatedTime?.inGate?.local;
    const effectiveDate = localArrival?.slice(0, 10) ?? scheduledDate;
    const effectiveTime = localArrival?.slice(11, 16) ?? scheduledTime;
    if (
        (localArrival && localArrival[10] !== 'T') ||
        !datePattern.test(effectiveDate) ||
        !timePattern.test(effectiveTime) ||
        !airportPattern.test(actualAirport)
    ) {
        throw new Error('Invalid OAG arrival status');
    }
    if (scheduledDate !== input.arrivalDate && effectiveDate !== input.arrivalDate) return;
    // OAG can return the entire through-flight alongside its actual inbound leg.
    if ((flight.segmentInfo?.numberOfStops ?? 0) > 0) return 'THROUGH_FLIGHT';

    let flightStatus: FlightStatus = 'SCHEDULED';
    if (status?.state === 'Canceled') flightStatus = 'CANCELLED';
    else if (actualAirport !== scheduledAirport || status?.irregularOperationType === 'Diversion')
        flightStatus = 'DIVERTED';
    else if (effectiveDate !== input.arrivalDate) flightStatus = 'ARRIVAL_CHANGED';

    return {
        flightNumber: input.flightNumber.replace(/\s/g, '').toUpperCase(),
        operatingFlightNumber: operatingDesignator ?? (operating ? null : designator),
        departureAirport: origin,
        arrivalAirport: actualAirport,
        scheduledArrivalDate: scheduledDate,
        scheduledArrivalTime: scheduledTime,
        effectiveArrivalDate: effectiveDate,
        effectiveArrivalTime: effectiveTime,
        status: flightStatus,
    };
}

@Injectable()
export class MdacFlightLookupService {
    private requestMinute = -1;
    private lookupCount = 0;
    private lookupsByIp = new Map<string, number>();
    private inFlightLookups = 0;

    private providerDay = -1;
    private providerRequestCount = 0;

    async lookup(input: FlightLookupInput, clientIp: string): Promise<MdacFlightLookupResult> {
        const key = subscriptionKey();
        if (!key) return { status: 'NOT_CONFIGURED', flights: [] };
        const today = dayLabel(Date.now() + malaysiaOffset);
        const arrivalMidnight = Date.parse(input.arrivalDate);
        const designator =
            input.flightNumber.length <= 30
                ? input.flightNumber.replace(/\s/g, '').toUpperCase().match(flightPattern)
                : null;
        if (
            !datePattern.test(input.arrivalDate) ||
            !Number.isFinite(arrivalMidnight) ||
            dayLabel(arrivalMidnight) !== input.arrivalDate ||
            input.arrivalDate < today ||
            input.arrivalDate > dayLabel(Date.parse(today) + 30 * dayMs) ||
            !airportPattern.test(input.arrivalAirport) ||
            !designator ||
            Number(designator[2]) === 0
        ) {
            return { status: 'INVALID_INPUT', flights: [] };
        }
        if (!this.reserveLookup(clientIp)) return { status: 'UNAVAILABLE', flights: [] };
        this.inFlightLookups++;
        try {
            return await this.lookupOag(input, arrivalMidnight, designator, key);
        } catch {
            // Provider errors can contain account metadata. Never return or log raw bodies.
            return { status: 'UNAVAILABLE', flights: [] };
        } finally {
            this.inFlightLookups--;
        }
    }

    private reserveLookup(clientIp: string): boolean {
        const minute = Math.floor(Date.now() / minuteMs);
        if (minute !== this.requestMinute) {
            this.requestMinute = minute;
            this.lookupCount = 0;
            this.lookupsByIp.clear();
        }
        const used = this.lookupsByIp.get(clientIp) ?? 0;
        if (used >= 10 || this.lookupCount >= 60 || this.inFlightLookups >= 6) return false;
        this.lookupCount++;
        this.lookupsByIp.set(clientIp, used + 1);
        return true;
    }

    private async fetchPage(params: URLSearchParams, key: string, signal: AbortSignal): Promise<OagPage> {
        const day = Math.floor((Date.now() + malaysiaOffset) / dayMs);
        if (day !== this.providerDay) {
            this.providerDay = day;
            this.providerRequestCount = 0;
        }
        // Bound paid provider traffic even if callers vary IPs or GraphQL aliases.
        if (this.providerRequestCount >= 600) throw new Error('OAG daily request budget reached');
        this.providerRequestCount++;
        const result = await fetch(`${oagEndpoint}?${params.toString()}`, {
            redirect: 'error',
            headers: { Accept: 'application/json', 'Subscription-Key': key },
            signal,
        });
        if (result.status !== 200) throw new Error('OAG request failed');
        const page = (await result.json()) as OagPage;
        if (!Array.isArray(page.data) || page.data.length > Number(params.get('Limit')) || !page.paging) {
            throw new Error('Invalid OAG pagination envelope');
        }
        return page;
    }

    private async lookupOag(
        input: FlightLookupInput,
        arrivalMidnight: number,
        designator: RegExpMatchArray,
        key: string,
    ): Promise<MdacFlightLookupResult> {
        const signal = AbortSignal.timeout(6500);
        const base = {
            version: 'v2',
            ArrivalAirport: input.arrivalAirport,
            ArrivalCountryCode: 'MY',
            CodeType: 'IATA',
            FlightType: 'Scheduled,Unscheduled',
            ServiceType: passengerServiceTypes,
        };
        const flightNumber = String(Number(designator[2]));
        const requestedDesignator = designator[1] + flightNumber + designator[3];
        const params = new URLSearchParams({
            ...base,
            // A flight landing this day may have been scheduled before midnight.
            ArrivalDateTime: dayLabel(arrivalMidnight - dayMs) + '/' + dayLabel(arrivalMidnight + dayMs),
            CarrierCode: designator[1],
            FlightNumber: flightNumber,
            Codeshare: 'Operating,Marketing',
            Content: 'Status',
            IncludeDiverted: 'true',
            Limit: '10',
        });
        const flights = new Map<string, MdacFlight>();
        let sawThroughFlight = false;
        let readCount = 0;
        for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
            const page = await this.fetchPage(params, key, signal);
            readCount += page.data.length;
            for (const raw of page.data) {
                const flight = parseFlight(raw, input, requestedDesignator);
                if (flight === 'THROUGH_FLIGHT') {
                    sawThroughFlight = true;
                    continue;
                }
                if (!flight) continue;
                const flightKey = [
                    flight.operatingFlightNumber,
                    flight.departureAirport,
                    flight.arrivalAirport,
                    flight.scheduledArrivalDate,
                    flight.scheduledArrivalTime,
                ].join(':');
                const existing = flights.get(flightKey);
                if (!existing || existing.status === 'SCHEDULED') flights.set(flightKey, flight);
            }
            if (!page.paging.next) {
                if (
                    (page.paging.totalCount ?? readCount) > readCount ||
                    (page.paging.totalPages ?? 0) > pageNumber + 1 ||
                    flights.size > 8
                ) {
                    return { status: 'UNAVAILABLE', flights: [] };
                }
                if (flights.size) return { status: 'MATCHED', flights: [...flights.values()] };
                if (sawThroughFlight || page.data.length === 10) {
                    return { status: 'UNAVAILABLE', flights: [] };
                }
                // An empty response alone cannot distinguish an unmatched flight
                // from schedule coverage missing for this airport/date.
                const coverage = await this.fetchPage(
                    new URLSearchParams({ ...base, ArrivalDateTime: input.arrivalDate, Limit: '1' }),
                    key,
                    signal,
                );
                const hasCoverage = coverage.data.some(
                    item =>
                        item?.arrival?.airport?.iata === input.arrivalAirport &&
                        item.arrival.date?.local === input.arrivalDate &&
                        item.arrival.country?.code === 'MY',
                );
                return { status: hasCoverage ? 'NO_MATCH' : 'UNAVAILABLE', flights: [] };
            }
            const cursor = new URL(page.paging.next, oagEndpoint).searchParams.get('After');
            if (!cursor || cursor.length > 512 || cursor === params.get('After')) {
                return { status: 'UNAVAILABLE', flights: [] };
            }
            // Follow the cursor using the fixed provider host and original filters.
            params.set('After', cursor);
        }
        return { status: 'UNAVAILABLE', flights: [] };
    }
}
