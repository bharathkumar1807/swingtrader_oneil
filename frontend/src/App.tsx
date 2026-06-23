import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Dashboard from './pages/Dashboard'
import Screener from './pages/Screener'
import Watchlist from './pages/Watchlist'
import EntryPlanner from './pages/EntryPlanner'
import Positions from './pages/Positions'
import Journal from './pages/Journal'
import Analytics from './pages/Analytics'
import Backtest from './pages/Backtest'
import TradeReport from './pages/TradeReport'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } }
})

const NAV = [
  { to: '/', label: 'Dashboard', icon: '⬡' },
  { to: '/screener', label: 'Screener', icon: '🔍' },
  { to: '/watchlist', label: 'Watchlist', icon: '👁' },
  { to: '/entry', label: 'Entry Planner', icon: '📐' },
  { to: '/positions', label: 'Positions', icon: '📈' },
  { to: '/journal', label: 'Journal', icon: '📓' },
  { to: '/analytics', label: 'Analytics', icon: '📊' },
  { to: '/backtest',  label: 'Backtest',  icon: '⏪' },
  { to: '/report',    label: 'Trade Report', icon: '📋' },
]

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div style={{ display: 'flex', minHeight: '100vh', background: '#0A0E1A', color: '#E8EDF5' }}>
          {/* Sidebar */}
          <nav style={{
            width: 220, background: '#111827', borderRight: '1px solid #1E2A42',
            padding: '24px 0', display: 'flex', flexDirection: 'column', flexShrink: 0,
          }}>
            <div style={{ padding: '0 20px 24px', borderBottom: '1px solid #1E2A42' }}>
              <div style={{ fontSize: 11, color: '#00D4FF', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 4 }}>
                SWING TRADER
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}>
                O'Neil × Minervini
              </div>
            </div>

            <div style={{ padding: '16px 12px', flex: 1 }}>
              {NAV.map(item => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                    textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 700 : 400,
                    color: isActive ? '#00D4FF' : '#6B7A99',
                    background: isActive ? '#00D4FF15' : 'transparent',
                    transition: 'all 0.15s',
                  })}>
                  <span>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid #1E2A42' }}>
              <div style={{ fontSize: 11, color: '#3A4560' }}>Paper Trading Mode</div>
              <div style={{ fontSize: 12, color: '#00E676', fontWeight: 700 }}>● Active</div>
            </div>
          </nav>

          {/* Main content */}
          <main style={{ flex: 1, overflow: 'auto', padding: 28 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/screener" element={<Screener />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/entry" element={<EntryPlanner />} />
              <Route path="/positions" element={<Positions />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/backtest"  element={<Backtest />} />
              <Route path="/report"   element={<TradeReport />} />
            </Routes>
          </main>
        </div>
        <Toaster position="top-right" toastOptions={{
          style: { background: '#161D2F', color: '#E8EDF5', border: '1px solid #1E2A42' }
        }} />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
