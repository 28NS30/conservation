import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import MapPage from './pages/MapPage'
import ReportPage from './pages/ReportPage'

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<HomePage />} />
          <Route path='/map' element={<MapPage/>}/>
          <Route path='/report' element={<ReportPage/>}/>
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
