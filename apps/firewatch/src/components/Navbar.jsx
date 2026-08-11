import { Link } from 'react-router-dom'
import logo from '../assets/logo.png'

export default function Navbar(props) {
    return(
        <>
        <div className={`navbar text-xl bg-gray-700 shadow-sm w-screen h-[10vh] ${props.position}`}>
            <div className='flex flex-row flex-1'>
                <img src={logo} alt="logo-nav" className='object-contain w-20 h-20 -mr-5' />
                <Link to="/"><h1 className="btn btn-ghost ml-5 font-bold relative top-5">FireWatch Atlántico</h1></Link>
            </div>
            <div class="flex-none">
              <ul class="menu menu-horizontal px-1">
                <li><Link to='/map'>Mapa</Link></li>
                <li><Link to='/report'>Reportar</Link></li>
                <li><a href='https://wa.me/573164188637'>Contactanos</a></li>
              </ul>
            </div>
        </div>
        </>
    )
}