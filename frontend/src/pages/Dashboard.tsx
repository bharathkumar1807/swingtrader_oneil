// ─── Dashboard Page ───────────────────────────────────────────
import { useQuery } from '@tanstack/react-query'
import { positionsApi, journalApi, marketApi } from '../services/api'
import { useSignalR } from '../hooks/useSignalR'

export default function Dashboard() {
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: () => positionsApi.getOpen() })
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => journalApi.getStats() })
  const { data: market } = useQuery({ queryKey: ['market'], queryFn: () => marketApi.getCurrent() })

  const symbols = positions?.data?.map((p: any) => p.position.symbol) ?? []
  useSignalR(symbols) // connect SignalR and subscribe to open positions

  const s = stats?.data
  const m = market?.data

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24, letterSpacing: '-0.02em' }}>Dashboard</h1>

      {/* Market Direction Banner */}
      <div style={{
        background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12,
        padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ color: '#6B7A99', fontSize: 12, fontWeight: 700 }}>MARKET DIRECTION</div>
        <div style={{ color: '#00E676', fontWeight: 800, fontSize: 16 }}>
          {m?.direction ?? 'Set market direction →'}
        </div>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Trades', value: s?.totalTrades ?? 0, color: '#E8EDF5' },
          { label: 'Win Rate', value: s ? `${s.winRate?.toFixed(1)}%` : '—', color: '#00E676' },
          { label: 'Avg Gain', value: s ? `${s.avgGain?.toFixed(1)}%` : '—', color: '#00E676' },
          { label: 'Total P&L', value: s ? `$${s.totalPnL?.toFixed(0)}` : '—', color: s?.totalPnL >= 0 ? '#00E676' : '#FF4444' },
        ].map(stat => (
          <div key={stat.label} style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: '20px' }}>
            <div style={{ color: '#6B7A99', fontSize: 11, marginBottom: 8, fontWeight: 600 }}>{stat.label}</div>
            <div style={{ color: stat.color, fontSize: 28, fontWeight: 900, fontFamily: 'monospace' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Open Positions */}
      <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#00D4FF', letterSpacing: '0.08em' }}>
          OPEN POSITIONS
        </h2>
        {positions?.data?.length === 0 && (
          <div style={{ color: '#3A4560', textAlign: 'center', padding: 32 }}>
            No open positions — build a setup in Entry Planner
          </div>
        )}
        {positions?.data?.map((item: any) => (
          <div key={item.position.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 0', borderBottom: '1px solid #1E2A42',
          }}>
            <div>
              <div style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: 16 }}>{item.position.symbol}</div>
              <div style={{ color: '#6B7A99', fontSize: 12 }}>{item.position.shares} shares · {item.daysHeld}d held</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 16 }}>${item.currentPrice?.toFixed(2)}</div>
              <div style={{ color: item.unrealizedPnLPct >= 0 ? '#00E676' : '#FF4444', fontWeight: 700, fontSize: 13 }}>
                {item.unrealizedPnLPct >= 0 ? '+' : ''}{item.unrealizedPnLPct?.toFixed(2)}%
              </div>
            </div>
            {item.isAtTarget20 && (
              <div style={{ background: '#00E67622', color: '#00E676', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                🎯 20% TARGET
              </div>
            )}
            {item.isNearStop && (
              <div style={{ background: '#FF444422', color: '#FF4444', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                ⚠ NEAR STOP
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
