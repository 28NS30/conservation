import Map from '../components/Map'
import Navbar from '../components/Navbar.jsx'

export default function MapPage(){
    return(
        <>
        <Navbar/>
        <div className='grid'>
            <div className="col-start-1 row-start-1 relative top-10 left-10 w-fit h-fit rounded p-3 bg-gray-900 z-10">
              <h4 className='font-bold'>Leyenda</h4>
              <p>🔴 Alerta Roja(alta certeza)</p>
              <p>🟠 Alerta Naranja(certeza media)</p>
              <p>🟡 Alerta Amarilla(baja certeza)</p>
            </div>
            <Map style='w-screen h-screen col-start-1 row-start-1 z-0' lng='-74.7833' lat='10.9833'/>
        </div>
        </>
    )
}