import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { StoreProvider } from './context/StoreContext'
import { AuthGuard } from './components/AuthGuard'
import Dashboard from './components/Dashboard'
import ReportView from './components/ReportView'
import FastScan from './components/FastScan'
import MovementLedger from './components/MovementLedger'
import DebtorsLedger from './components/DebtorsLedger'
import InventoryReconciliation from './components/InventoryReconciliation'
import LandingPage from './pages/LandingPage'

function App() {
  return (
    <StoreProvider>
      <Router>
          <Routes>
            <Route path="/ventas" element={<LandingPage />} />
            <Route path="/" element={<AuthGuard><Dashboard /></AuthGuard>} />
            <Route path="/report/:token" element={<AuthGuard><ReportView /></AuthGuard>} />
            <Route path="/ledger" element={<AuthGuard><MovementLedger /></AuthGuard>} />
            <Route path="/scan/:token" element={<AuthGuard><FastScan /></AuthGuard>} />
            <Route path="/debtors" element={<AuthGuard><DebtorsLedger /></AuthGuard>} />
            <Route path="/audit" element={<AuthGuard><InventoryReconciliation /></AuthGuard>} />
          </Routes>
      </Router>
    </StoreProvider>
  )
}

export default App
