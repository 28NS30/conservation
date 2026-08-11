import { useRef, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import circleToPolygon from 'circle-to-polygon'
import mapboxgl from 'mapbox-gl'

import 'mapbox-gl/dist/mapbox-gl.css';

const RADIUS_BY_TYPE = { red: 800, orange: 500 }
const DEFAULT_RADIUS = 400
const COLOR_BY_TYPE = { red: '#DC143C', orange: '#CC5500', yellow: '#FFD700' }

function Map(props) {
    const mapRef = useRef()
    const mapContainerRef = useRef()

    useEffect(() => {
      mapRef.current = new mapboxgl.Map({
        accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
        style: "mapbox://styles/mapbox/dark-v11",
        container: mapContainerRef.current,
        minZoom: 10,
        zoom: 10,
        center: [props.lng, props.lat]
      });

      mapRef.current.resize()

      async function loadEntries() {
        let entries = await getEntries()
        
        const addAll = () => {
          entries.forEach((entry) => {
            const radius = RADIUS_BY_TYPE[entry.report_type] ?? DEFAULT_RADIUS
            const color = COLOR_BY_TYPE[entry.report_type]
            const id = entry.id.toString()
            const [lngFire, latFire] = entry.data.fire_location
            //const [lngLocation, latLocation] = entry.data.current_location

            let popup = new mapboxgl.Popup({ offset: 25 }).setText(`Report ID: ${id}`);
            //new mapboxgl.Marker({color: "#06402B"}).setLngLat([lngLocation, latLocation]).setPopup(popup).addTo(mapRef.current)

            mapRef.current.addSource(id, {
              type: 'geojson',
              data: circleToPolygon([lngFire, latFire], radius, 32)
            })

            mapRef.current.addLayer({
              id,
              type: 'fill',
              source: id,
              paint: { 'fill-color': color, 'fill-opacity': 0.5 }
            })

            mapRef.current.addLayer({
              id: `${id}-outline`,
              type: 'line',
              source: id,
              paint: { 'line-color': '#000', 'line-width': 3 }
            })

            mapRef.current.on('click', id, (e)=>{
              new mapboxgl.Popup({ offset: 25 }).setLngLat(e.lngLat).setText(`${new Date(entry.created_at).toLocaleDateString()}`).addTo(mapRef.current)
            })
          })
        }

        if (mapRef.current.isStyleLoaded()) {
          addAll()
        } 
        else {
          mapRef.current.on('load', addAll)
        }
      }

      loadEntries()

      return () => {
        mapRef.current.remove()
      }
    }, [])

    async function getEntries() {
        const { data, error } = await supabase.from('reports').select('*')
        if (error) {
            console.error(error)
            return
        }
        return data
    }

    return (
        <>
            <div className={props.style} id="map-container" ref={mapContainerRef}></div>
        </>
    )
}

export default Map