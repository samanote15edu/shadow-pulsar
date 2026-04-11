import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { StoreProvider } from './context/StoreContext'
import Dashboard from './components/Dashboard'
import ReportView from './components/ReportView'
import FastScan from './components/FastScan'
import MovementLedger from './components/MovementLedger'
import DebtorsLedger from './components/DebtorsLedger'
import InventoryReconciliation from './components/InventoryReconciliation'

function App() {
  return (
    <StoreProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/report/:token" element={<ReportView />} />
          <Route path="/ledger" element={<MovementLedger />} />
          <Route path="/scan/:token" element={<FastScan />} />
          <Route path="/debtors" element={<DebtorsLedger />} />
          <Route path="/audit" element={<InventoryReconciliation />} />
        </Routes>
      </Router>
    </StoreProvider>
  )
}

export default App
