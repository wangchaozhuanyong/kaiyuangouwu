import type { ShopApi } from '../../api';

export interface MdacFlightSearch {
    arrivalDate: string;
    arrivalAirport: string;
    flightNumber: string;
}

export interface MdacFlight {
    flightNumber: string;
    operatingFlightNumber: string | null;
    departureAirport: string;
    arrivalAirport: string;
    scheduledArrivalDate: string;
    scheduledArrivalTime: string;
    effectiveArrivalDate: string;
    effectiveArrivalTime: string;
    status: 'SCHEDULED' | 'CANCELLED' | 'ARRIVAL_CHANGED' | 'DIVERTED';
}

export interface MdacFlightResult {
    status: 'MATCHED' | 'NO_MATCH' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'INVALID_INPUT';
    flights: MdacFlight[];
}

export type MdacFlightLookup = (input: MdacFlightSearch, signal: AbortSignal) => Promise<MdacFlightResult>;

export function isTicketFlightNumber(value: string) {
    const match = /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])([0-9]{1,4})[A-Z]?$/u.exec(value);
    return Boolean(match && Number(match[1]) > 0);
}

export async function requestMdacFlights(api: ShopApi, input: MdacFlightSearch, signal: AbortSignal) {
    const { mdacFlightLookup } = await api.request<{ mdacFlightLookup: MdacFlightResult }>(
        `query MdacFlightLookup($arrivalDate: String!, $arrivalAirport: String!, $flightNumber: String!) {
            mdacFlightLookup(arrivalDate: $arrivalDate, arrivalAirport: $arrivalAirport, flightNumber: $flightNumber) {
                status
                flights {
                    flightNumber operatingFlightNumber departureAirport arrivalAirport
                    scheduledArrivalDate scheduledArrivalTime effectiveArrivalDate effectiveArrivalTime status
                }
            }
        }`,
        { ...input },
        signal,
    );
    return mdacFlightLookup;
}
