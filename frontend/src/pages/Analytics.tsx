import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import { journalApi } from '../services/api'

export default function Analytics() {
  const { data: statsRes } = useQuery({ queryKey: ['stats'], queryFn: () => journalApi.getStats() })
  const { data: journalRes } = useQuery({ queryKey: ['journal'], queryFn: () => journalApi.getAll() })

  const s = statsRes?.data
  const trades: any[] = journalRes?.data ?? []

  // Build cumulative equity curve from closed trades (oldest first)
  const equityCurve = [...trades]
    .sort((a, b) => new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime())
    .reduce<{ trade: number; pnl: number; equity: number }[]>((acc, t, i) => {
      const prev = acc[i - 1]?.equity ?? 0
      acc.push({ trade: i + 1, pnl: t.realizedPnL, equity: prev + t.realizedPnL })
      return acc
    }, [])

  // Pattern performance breakdown
  const byPattern = trades.reduce<Record<string, { wins: number; total: number; pnl: number }>>((acc, t) => {
    const key = t.pattern || 'Unknown'
    if (!acc[key]) acc[key] = { wins: 0, total: 0, pnl: 0 }
    acc[key].total++
    acc[key].pnl += t.realizedPnL
    if (t.realizedPnL > 0) acc[key].wins++
    return acc
  }, {})

  const patternData = Object.entries(byPattern).map(([name, d]) => ({
    name,
    winRate: Math.round(d.wins / d.total * 100),
    pnl: Math.round(d.pnl),
    total: d.total,
  })).sort((a, b) => b.winRate - a.winRate)

  // Grade distribution
  const byGrade = trades.reduce<Record<string, number>>((acc, t) => {
    const g = t.grade || '—'
    acc[g] = (acc[g] || 0) + 1
    return acc
  }, {})

  const gradeData = Object.entries(byGrade).map(([grade, count]) => ({ grade, count }))

  const noTrades = trades.length === 0

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24, letterSpacing: '-0.02em' }}>Analytics</h1>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Win Rate', value: s ? `${s.winRate?.toFixed(1)}%` : '—', color: '#00E676', sub: `${s?.winners ?? 0}W / ${s?.losers ?? 0}L` },
          { label: 'Avg Win', value: s ? `+${s.avgGain?.toFixed(2)}%` : '—', color: '#00E676', sub: 'avg gain per winner' },
          { label: 'Avg Loss', value: s ? `${s.avgLoss?.toFixed(2)}%` : '—', color: '#FF4444', sub: 'avg loss per loser' },
          { label: 'Profit Factor', value: s ? s.profitFactor?.toFixed(2) : '—', color: s?.profitFactor >= 1.5 ? '#00E676' : '#FFD600', sub: 'gross profit / gross loss' },
        ].map(stat => (
          <div key={stat.label} style={card}>
            <div style={dimLabel}>{stat.label}</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 28, color: stat.color }}>{stat.value}</div>
            <div style={{ color: '#3A4560', fontSize: 11, marginTop: 4 }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Best/Worst */}
      {s?.bestTrade && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <div style={{ ...card, borderColor: '#00E67644' }}>
            <div style={dimLabel}>BEST TRADE</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 22, color: '#00E676' }}>{s.bestTrade}</div>
          </div>
          <div style={{ ...card, borderColor: '#FF444444' }}>
            <div style={dimLabel}>WORST TRADE</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 22, color: '#FF4444' }}>{s.worstTrade}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Equity Curve */}
        <div style={card}>
          <div style={{ ...sectionLabel, marginBottom: 16 }}>CUMULATIVE P&L</div>
          {noTrades ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={equityCurve}>
                <XAxis dataKey="trade" tick={{ fill: '#3A4560', fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: 'Trade #', position: 'insideBottom', offset: -2, fill: '#3A4560', fontSize: 10 }} />
                <YAxis tick={{ fill: '#3A4560', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #1E2A42', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={v => `Trade #${v}`}
                  formatter={(value: number) => [`${value >= 0 ? '+' : ''}$${value.toFixed(0)}`, 'Cumulative P&L']}
                />
                <Line
                  type="monotone" dataKey="equity" stroke="#00D4FF" strokeWidth={2}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props
                    return <circle key={`dot-${payload.trade}`} cx={cx} cy={cy} r={3} fill={payload.pnl >= 0 ? '#00E676' : '#FF4444'} />
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Grade Distribution */}
        <div style={card}>
          <div style={{ ...sectionLabel, marginBottom: 16 }}>TRADE GRADES</div>
          {noTrades ? <Empty /> : (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={gradeData} barSize={40}>
                  <XAxis dataKey="grade" tick={{ fill: '#6B7A99', fontSize: 13, fontWeight: 700 }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1E2A42', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {gradeData.map((entry) => (
                      <Cell key={entry.grade} fill={entry.grade === 'A' ? '#00E676' : entry.grade === 'B' ? '#FFD600' : '#FF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                {gradeData.map(g => (
                  <div key={g.grade} style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 22, color: g.grade === 'A' ? '#00E676' : g.grade === 'B' ? '#FFD600' : '#FF4444' }}>{g.count}</div>
                    <div style={{ color: '#3A4560', fontSize: 11 }}>Grade {g.grade}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pattern Performance */}
      {patternData.length > 0 && (
        <div style={card}>
          <div style={{ ...sectionLabel, marginBottom: 16 }}>PATTERN PERFORMANCE</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Pattern', 'Trades', 'Win Rate', 'Total P&L'].map(h => (
                  <th key={h} style={{ color: '#3A4560', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '0 0 12px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patternData.map(p => (
                <tr key={p.name} style={{ borderBottom: '1px solid #1E2A42' }}>
                  <td style={{ padding: '10px 0', fontWeight: 700 }}>{p.name}</td>
                  <td style={{ padding: '10px 0', color: '#6B7A99', fontFamily: 'monospace' }}>{p.total}</td>
                  <td style={{ padding: '10px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ height: 6, width: 80, background: '#1E2A42', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${p.winRate}%`, background: p.winRate >= 60 ? '#00E676' : p.winRate >= 40 ? '#FFD600' : '#FF4444', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: p.winRate >= 60 ? '#00E676' : p.winRate >= 40 ? '#FFD600' : '#FF4444' }}>
                        {p.winRate}%
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 0', fontFamily: 'monospace', fontWeight: 700, color: p.pnl >= 0 ? '#00E676' : '#FF4444' }}>
                    {p.pnl >= 0 ? '+' : ''}${p.pnl.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3A4560', fontSize: 13 }}>
      Close some trades to see data here
    </div>
  )
}

const card: React.CSSProperties = { background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }
const dimLabel: React.CSSProperties = { color: '#6B7A99', fontSize: 11, fontWeight: 600, marginBottom: 6 }
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#00D4FF' }
