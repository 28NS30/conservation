import logo from '../assets/logo.png'

export default function Footer() {
    return(
        <>
            <footer className='footer footer-horizontal w-screen p-10 mt-5 bg-gray-700'>
              <aside className='flex flex-row'>
                <div>
                  <img src={logo} alt="logo" className='w-35 h-35 object-contain' />
                </div>
                <p className='font-bold text-xl relative top-[50%] translate-y-[-50%]'>Proyecto FireWatch Atlántico</p>
              </aside>
              <nav>
                <h6 className="footer-title">About</h6>
                <a className="link link-hover">Sobre Nosotros</a>
                <a className="link link-hover">Contactanos</a>
                <a className="link link-hover">Nuestra Mision</a>
              </nav>
            </footer>
        </>
    )
}