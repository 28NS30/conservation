import Navbar from '../components/Navbar.jsx'
import ReportForm from '../components/ReportForm.jsx'
import Footer from '../components/Footer.jsx'

export default function ReportPage(){
    return(
        <>
            <Navbar/>
            <div className='flex justify-center items-center h-150 bg-gray-800 m-10 rounded'>
                <ReportForm/>
            </div>
            <Footer/>
        </>
    )
}