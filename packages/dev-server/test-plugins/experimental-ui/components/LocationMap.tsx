import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { Card } from '@vendure/admin-ui/react';
import React, { useEffect } from 'react';

declare global {
    interface Window {
        vendureGoogleMapsApiKey?: string;
    }
}

const containerStyle = {
    width: '100%',
    height: '400px',
};

const center = {
    lat: 48.212616,
    lng: 16.3230408,
};

export function LocationMap() {
    const googleMapsApiKey = window.vendureGoogleMapsApiKey?.trim() ?? '';

    if (!googleMapsApiKey) {
        return <Card>Set window.vendureGoogleMapsApiKey to enable this experimental map.</Card>;
    }

    return <LoadedLocationMap googleMapsApiKey={googleMapsApiKey} />;
}

function LoadedLocationMap({ googleMapsApiKey }: { googleMapsApiKey: string }) {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey,
    });

    const [googleMap, setGoogleMap] = React.useState(null);

    const onLoad = React.useCallback(function callback(loadedMap) {
        // This is just an example of getting and using the map instance!!! don't just blindly copy!

        const bounds = new window.google.maps.LatLngBounds(center);
        loadedMap.fitBounds(bounds);
        setGoogleMap(loadedMap);
        new window.google.maps.Marker({
            position: center,
            map: loadedMap,
            title: 'Hello World!',
        });
    }, []);

    useEffect(() => {
        setTimeout(() => {
            (googleMap as any)?.setZoom(9);
        }, 1000);
    }, [googleMap]);

    const onUnmount = React.useCallback(function callback() {
        setGoogleMap(null);
    }, []);

    return isLoaded ? (
        <div className="mb-4">
            <Card title="Location">
                <GoogleMap
                    mapContainerStyle={containerStyle}
                    center={center}
                    onLoad={onLoad}
                    onUnmount={onUnmount}
                    options={{
                        zoom: 20,
                        minZoom: 10,
                        fullscreenControl: false,
                        streetViewControl: false,
                        zoomControl: false,
                        mapTypeControl: false,
                    }}
                >
                    {/* Child components, such as markers, info windows, etc. */}
                    <></>
                </GoogleMap>
            </Card>
        </div>
    ) : (
        <></>
    );
}
