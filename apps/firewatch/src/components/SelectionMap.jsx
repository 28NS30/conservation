import { useEffect, useRef } from "react"
import mapboxgl from 'mapbox-gl'

export default function SelectionMap(props) {
    const mapRef = useRef()
    const mapContainerRef = useRef()
    
    useEffect(()=>{
        mapRef.current = new mapboxgl.Map({
            accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
            container: mapContainerRef.current,
            minZoom: 10,
            zoom: 10,
            center: [-74.7889, 10.9878]
        });

        const marker = new mapboxgl.Marker();

        mapRef.current.resize()

        mapRef.current.on('click', (e)=>{
            const { lng, lat } = e.lngLat;
            props.setLocation([lng, lat])
            marker.setLngLat([lng, lat]).addTo(mapRef.current);
        })

        return () => mapRef.current.remove()
    }, [])
    
    return (
        <>
            <div id='mapContainer' ref={mapContainerRef} className={props.style}></div>
        </>
    )
}