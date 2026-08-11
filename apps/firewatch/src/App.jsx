import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import MapPage from './pages/MapPage'
import ReportPage from './pages/ReportPage'

// Kept in step with vite.config.js's `base`. BrowserRouter matches on the path
// after this prefix, so without it every route below misses and the app renders
// nothing at /firewatch.
const BASE = '/firewatch'

function App() {
  return (
    <>
      <BrowserRouter basename={BASE}>
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
