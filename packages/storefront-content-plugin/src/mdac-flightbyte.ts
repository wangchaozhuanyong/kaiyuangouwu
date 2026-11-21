import type { FlightLookupInput, MdacFlight, MdacFlightLookupResult } from './mdac-flight-lookup.service';

const dayMs = 86_400_000;
const minuteMs = 60_000;
const maxRequestsPerMinute = 30;
const maxCachedFlights = 120;
const quotaWindows = ['minute', 'day', 'month'] as const;
const airportPattern = /^[A-Z]{3}$/u;
const localTimePattern = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/u;
const normalPhases = new Set(['scheduled', 'boarding', 'departed', 'en_route', 'landed', 'arrived']);
const unavailable: MdacFlightLookupResult = { status: 'UNAVAILABLE', flights: [] };

interface FlightByteAirport {
    iata?: string;
    country?: { code?: string };
}

type ArrivalTimes = Partial<
    Record<
        | 'scheduledGate'
        | 'scheduledRunway'
        | 'estimatedGate'
        | 'estimatedRunway'
        | 'actualGate'
        | 'actualRunway',
        { local?: string }
    >
>;

interface FlightByteSnapshot {
    carrierCode?: string;
    flightNumber?: string;
    date?: string;
    operatedBy?: string | null;
    codeshares?: Array<{ carrier?: string; flightNumber?: string; name?: string }>;
    departure?: { airport?: FlightByteAirport };
    arrival?: { airport?: FlightByteAirport; times?: ArrivalTimes };
    diverted?: { airport?: FlightByteAirport; times?: ArrivalTimes } | null;
    status?: { phase?: string; cancelled?: boolean; diverted?: boolean };
}

function ticketNumber(carrier?: string, value?: string) {
    if (typeof carrier !== 'string' || typeof value !== 'string') return;
    const match = /^(?:([A-Z][A-Z0-9]|[0-9][A-Z]))(\d{1,4})([A-Z]?)$/u.exec(carrier + value);
    if (match && Number(match[2]) > 0) return match[1] + Number(match[2]) + match[3];
}

function arrivalTime(value?: string) {
    const match = typeof value === 'string' ? localTimePattern.exec(value) : null;
    if (!match) return;
    const epoch = Date.parse(match[1]);
    if (Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === match[1]) {
        return { date: match[1], time: match[2] };
    }
}

function effectiveTime(times?: ArrivalTimes) {
    return (
        arrivalTime(times?.actualRunway?.local) ??
        arrivalTime(times?.actualGate?.local) ??
        arrivalTime(times?.estimatedRunway?.local) ??
        arrivalTime(times?.estimatedGate?.local)
    );
}

function mapFlight(
    flight: FlightByteSnapshot,
    input: FlightLookupInput,
    departureDate: string,
    expectedTicket: string,
): MdacFlight | undefined {
    const mainTicket = ticketNumber(flight?.carrierCode, flight?.flightNumber);
    if (!mainTicket || flight.date !== departureDate) throw new Error('Invalid FlightByte flight identifier');
    const codeshares = flight.codeshares ?? [];
    if (!Array.isArray(codeshares)) throw new Error('Invalid FlightByte codeshares');
    const aliases = codeshares.map(alias => ({
        ticket: ticketNumber(alias?.carrier, alias?.flightNumber),
        airline: typeof alias?.name === 'string' ? alias.name.trim().toUpperCase() : undefined,
    }));
    if (mainTicket !== expectedTicket && !aliases.some(alias => alias.ticket === expectedTicket)) return;

    const departure = flight.departure?.airport;
    const arrival = flight.arrival?.airport;
    const departureAirport = departure?.iata;
    const scheduledAirport = arrival?.iata;
    const departureCountry = departure?.country?.code;
    if (
        !departureAirport ||
        !airportPattern.test(departureAirport) ||
        !scheduledAirport ||
        !airportPattern.test(scheduledAirport) ||
        typeof departureCountry !== 'string' ||
        !/^[A-Z]{2}$/u.test(departureCountry)
    ) {
        throw new Error('Invalid FlightByte route');
    }
    if (
        departureCountry === 'MY' ||
        arrival?.country?.code !== 'MY' ||
        scheduledAirport !== input.arrivalAirport
    )
        return;

    const times = flight.arrival?.times;
    const scheduled = arrivalTime(times?.scheduledGate?.local) ?? arrivalTime(times?.scheduledRunway?.local);
    if (!scheduled) throw new Error('Invalid FlightByte scheduled arrival');

    const phase = flight.status?.phase ?? '';
    const cancelled = flight.status?.cancelled === true || phase === 'cancelled';
    const diverted = flight.status?.diverted === true || phase === 'diverted' || phase === 'redirected';
    const diversionAirport = diverted ? flight.diverted?.airport?.iata : undefined;
    if (diversionAirport && !airportPattern.test(diversionAirport)) {
        throw new Error('Invalid FlightByte diversion airport');
    }
    const effective = (diverted ? effectiveTime(flight.diverted?.times) : effectiveTime(times)) ?? scheduled;
    if (scheduled.date !== input.arrivalDate && effective.date !== input.arrivalDate) return;
    if (!cancelled && !diverted && !normalPhases.has(phase))
        throw new Error('Unknown FlightByte flight status');

    const operatingName = typeof flight.operatedBy === 'string' ? flight.operatedBy.trim().toUpperCase() : '';
    const operatingAliases = operatingName ? aliases.filter(alias => alias.airline === operatingName) : [];
    return {
        flightNumber: input.flightNumber.replace(/\s/g, '').toUpperCase(),
        operatingFlightNumber: operatingName
            ? operatingAliases.length === 1
                ? (operatingAliases[0].ticket ?? null)
                : null
            : mainTicket,
        departureAirport,
        arrivalAirport: diversionAirport ?? scheduledAirport,
        scheduledArrivalDate: scheduled.date,
        scheduledArrivalTime: scheduled.time,
        effectiveArrivalDate: effective.date,
        effectiveArrivalTime: effective.time,
        status: cancelled
            ? 'CANCELLED'
            : diverted
              ? 'DIVERTED'
              : effective.date !== input.arrivalDate
                ? 'ARRIVAL_CHANGED'
                : 'SCHEDULED',
    };
}

function retryAt(response: Response, now: number): number {
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter && /^\d+$/u.test(retryAfter)) return now + Math.max(1, Number(retryAfter)) * 1000;
    const retryDate = retryAfter ? Date.parse(retryAfter) : NaN;
    return Number.isFinite(retryDate) && retryDate > now ? retryDate : now + minuteMs;
}

function exhaustedQuotaReset(headers: Headers, now: number): number {
    let blockedUntil = now;
    for (const window of quotaWindows) {
        if (headers.get('X-RateLimit-Remaining-' + window) !== '0') continue;
        const value = headers.get('X-RateLimit-Reset-' + window);
        const reset = value && /^\d{1,10}$/u.test(value) ? Number(value) * 1000 : 0;
        blockedUntil = Math.max(blockedUntil, reset > now ? reset : now + minuteMs);
    }
    return blockedUntil;
}

export class MdacFlightByteLookup {
    private readonly cache = new Map<string, { flight: MdacFlightLookupResult; expires: number }>();
    private readonly inFlight = new Map<string, Promise<MdacFlightLookupResult>>();
    private requestMinute = -1;
    private requestCount = 0;
    private blockedUntil = 0;

    async lookup(
        input: FlightLookupInput,
        arrivalMidnight: number,
        today: string,
        designator: RegExpMatchArray,
        key: string,
    ): Promise<MdacFlightLookupResult> {
        if (arrivalMidnight > Date.parse(today) + 2 * dayMs) return unavailable;
        const carrier = designator[1];
        const number = String(Number(designator[2])) + designator[3];
        const expectedTicket = carrier + number;
        const cacheKey = [input.arrivalDate, input.arrivalAirport, expectedTicket].join(':');
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > Date.now()) return this.withTicket(cached.flight, input.flightNumber);

        let pending = this.inFlight.get(cacheKey);
        if (!pending) {
            pending = this.lookupDates(input, arrivalMidnight, carrier, number, key)
                .then(result => {
                    if (result.status !== 'UNAVAILABLE') {
                        this.cache.delete(cacheKey);
                        if (this.cache.size >= maxCachedFlights) {
                            const oldest = this.cache.keys().next().value;
                            if (oldest) this.cache.delete(oldest);
                        }
                        this.cache.set(cacheKey, { flight: result, expires: Date.now() + minuteMs });
                    }
                    return result;
                })
                .finally(() => this.inFlight.delete(cacheKey));
            this.inFlight.set(cacheKey, pending);
        }
        return this.withTicket(await pending, input.flightNumber);
    }

    private withTicket(result: MdacFlightLookupResult, value: string): MdacFlightLookupResult {
        const flightNumber = value.replace(/\s/g, '').toUpperCase();
        return {
            status: result.status,
            flights: result.flights.map(flight => ({ ...flight, flightNumber })),
        };
    }

    private async lookupDates(
        input: FlightLookupInput,
        arrivalMidnight: number,
        carrier: string,
        number: string,
        key: string,
    ): Promise<MdacFlightLookupResult> {
        const signal = AbortSignal.timeout(6500);
        let changed: MdacFlight | undefined;
        const priorDate = new Date(arrivalMidnight - dayMs).toISOString().slice(0, 10);
        for (const departureDate of [input.arrivalDate, priorDate]) {
            if (!this.reserveRequest()) return unavailable;
            const url = new URL(
                `https://api.flightbyte.dev/v1/flights/${carrier}/${number}/${departureDate}`,
            );
            url.searchParams.set('destination', input.arrivalAirport);
            const response = await fetch(url.toString(), {
                headers: { Accept: 'application/json', 'x-api-key': key },
                redirect: 'error',
                signal,
            });
            const now = Date.now();
            this.blockedUntil = Math.max(this.blockedUntil, exhaustedQuotaReset(response.headers, now));
            if (response.status === 429)
                this.blockedUntil = Math.max(this.blockedUntil, retryAt(response, now));
            if (response.status === 404) {
                const failure = (await response.json()) as { statusCode?: number } | null;
                if (failure?.statusCode === 404) continue;
                return unavailable;
            }
            if (response.status !== 200) return unavailable;

            const flight = mapFlight(
                (await response.json()) as FlightByteSnapshot,
                input,
                departureDate,
                carrier + number,
            );
            if (!flight) continue;
            if (flight.status !== 'ARRIVAL_CHANGED') return { status: 'MATCHED', flights: [flight] };
            changed ??= flight;
        }
        return changed ? { status: 'MATCHED', flights: [changed] } : { status: 'NO_MATCH', flights: [] };
    }

    private reserveRequest() {
        const now = Date.now();
        if (now < this.blockedUntil) return false;
        const minute = Math.floor(now / minuteMs);
        if (minute !== this.requestMinute) {
            this.requestMinute = minute;
            this.requestCount = 0;
        }
        if (this.requestCount >= maxRequestsPerMinute) return false;
        this.requestCount++;
        return true;
    }
}
