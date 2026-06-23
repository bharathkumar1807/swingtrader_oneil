import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import toast from 'react-hot-toast'
import { backtestApi } from '../services/api'

export default function Backtest() {
  const [form, setForm] = useState({
    symbol: 'NVDA',
    startDate: '2022-10-01',
    endDate: '2025-12-31',
    accountSize: 100000,
    riskPercent: 1,
  })
  const [result, setResult] = useState<any>(null)

  const mutation = useMutation({
    mutationFn: () => backtestApi.run(form),
    onSuccess: res => { setResult(res.data); toast.success('Backtest complete') },
    onError:   ()  => toast.error('Backtest failed — check symbol or date range'),
  })

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 6, letterSpacing: '-0.02em' }}>
        Backtest Simulator
      </h1>
      <p style={{ color: '#6B7A99', fontSize: 13, marginBottom: 24 }}>
        Replays Minervini template + volume breakout rules on historical Alpaca data.
        No look-ahead bias — each day only uses data available at that point in time.
      </p>

      {/* ── Parameters ─────────────────────────────────────── */}
      <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={sectionLabel}>PARAMETERS</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
          {([
            ['Symbol',       'symbol',      'text',   'NVDA'],
            ['Start Date',   'startDate',   'date',   ''],
            ['End Date',     'endDate',     'date',   ''],
            ['Account ($)',  'accountSize', 'number', ''],
            ['Risk %',       'riskPercent', 'number', ''],
          ] as const).map(([label, key, type]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <input
                type={type}
                value={(form as any)[key]}
                onChange={e => set(key, type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{
            background: '#00D4FF', color: '#000', fontWeight: 900,
            fontSize: 14, padding: '11px 28px', borderRadius: 8, border: 'none',
            cursor: mutation.isPending ? 'wait' : 'pointer',
            opacity: mutation.isPending ? 0.7 : 1,
          }}>
          {mutation.isPending ? 'Running simulation...' : 'Run Backtest'}
        </button>

        {/* Date range hint */}
        <div style={{ marginTop: 12, color: '#3A4560', fontSize: 12 }}>
          Tip: Use at least a 1-year range for meaningful results. Available data goes back ~3 years from today.
        </div>
      </div>

      {result && result.totalTrades === 0 && (
        <div style={{
          background: '#FFD60015', border: '1px solid #FFD60055',
          borderRadius: 10, padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ color: '#FFD600', fontWeight: 700, marginBottom: 6 }}>No Trades Found in This Range</div>
          <div style={{ color: '#6B7A99', fontSize: 13, lineHeight: 1.6 }}>
            The Minervini + breakout rules found no qualifying entries for <strong style={{ color: '#E8EDF5' }}>{result.symbol}</strong> between {form.startDate} and {form.endDate}.<br />
            Try: a longer date range (1–3 years), a different symbol, or check that the stock was in an uptrend during this period.
          </div>
        </div>
      )}

      {result && result.totalTrades > 0 && (
        <>
          {/* ── Summary Stats ─────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <StatCard label="Total Return" value={`${result.totalReturnPct > 0 ? '+' : ''}${result.totalReturnPct}%`}
              color={result.totalReturnPct >= 0 ? '#00E676' : '#FF4444'} sub={`$${result.finalEquity?.toLocaleString()}`} />
            <StatCard label="Win Rate" value={`${result.winRate}%`}
              color="#00D4FF" sub={`${result.winners}W / ${result.losers}L of ${result.totalTrades} trades`} />
            <StatCard label="Profit Factor" value={result.profitFactor}
              color={result.profitFactor >= 1.5 ? '#00E676' : result.profitFactor >= 1 ? '#FFD600' : '#FF4444'}
              sub={result.profitFactor >= 1.5 ? 'Strong edge' : result.profitFactor >= 1 ? 'Marginal edge' : 'No edge'} />
            <StatCard label="Max Drawdown" value={`-${result.maxDrawdownPct}%`}
              color={result.maxDrawdownPct <= 15 ? '#00E676' : result.maxDrawdownPct <= 25 ? '#FFD600' : '#FF4444'}
              sub="peak to trough" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <StatCard label="Avg Winner" value={`+${result.avgGainPct}%`} color="#00E676" sub="" />
            <StatCard label="Avg Loser"  value={`${result.avgLossPct}%`}  color="#FF4444" sub="" />
            <StatCard label="Expectancy" value={`${result.expectancyR > 0 ? '+' : ''}${result.expectancyR}R`}
              color={result.expectancyR > 0 ? '#00E676' : '#FF4444'} sub="avg R per trade" />
            <StatCard label="Edge Score"
              value={result.profitFactor >= 1.5 && result.winRate >= 35 ? 'VALID' : result.profitFactor >= 1 ? 'WEAK' : 'NONE'}
              color={result.profitFactor >= 1.5 && result.winRate >= 35 ? '#00E676' : result.profitFactor >= 1 ? '#FFD600' : '#FF4444'}
              sub={result.totalTrades >= 20 ? 'statistically meaningful' : 'need 20+ trades'} />
          </div>

          {/* ── Equity Curve ───────────────────────────────── */}
          <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={sectionLabel}>EQUITY CURVE</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={result.equityCurve} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E2A42" />
                <XAxis dataKey="date" tick={{ fill: '#6B7A99', fontSize: 10 }}
                  tickFormatter={v => v.slice(0, 7)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#6B7A99', fontSize: 10 }}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={52} />
                <Tooltip
                  contentStyle={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 8 }}
                  labelStyle={{ color: '#6B7A99' }}
                  formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Equity']} />
                <ReferenceLine y={form.accountSize} stroke="#3A4560" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="equity" stroke="#00D4FF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Trade Log ──────────────────────────────────── */}
          <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }}>
            <div style={sectionLabel}>TRADE LOG ({result.trades?.length} trades)</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#6B7A99' }}>
                    {['Entry Date','Exit Date','Entry','Stop','Target','Exit','P&L %','R','Days','Reason'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #1E2A42', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.trades?.map((t: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111827' }}>
                      <td style={tdStyle}>{t.entryDate?.slice(0, 10)}</td>
                      <td style={tdStyle}>{t.exitDate?.slice(0, 10)}</td>
                      <td style={tdStyle}>${t.entryPrice}</td>
                      <td style={{ ...tdStyle, color: '#FF4444' }}>${t.stopPrice}</td>
                      <td style={{ ...tdStyle, color: '#00E676' }}>${t.target}</td>
                      <td style={tdStyle}>${t.exitPrice}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: t.pnLPct >= 0 ? '#00E676' : '#FF4444' }}>
                        {t.pnLPct >= 0 ? '+' : ''}{t.pnLPct}%
                      </td>
                      <td style={{ ...tdStyle, color: t.rMultiple >= 0 ? '#00D4FF' : '#FF6B6B' }}>
                        {t.rMultiple >= 0 ? '+' : ''}{t.rMultiple}R
                      </td>
                      <td style={tdStyle}>{t.daysHeld}d</td>
                      <td style={{ ...tdStyle, color: t.exitReason === 'Target +20%' ? '#00E676' : t.exitReason === 'Stop Hit' ? '#FF4444' : '#FFD600' }}>
                        {t.exitReason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: any; color: string; sub: string }) {
  return (
    <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ color: '#6B7A99', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontFamily: 'monospace', fontWeight: 900, fontSize: 22 }}>{value}</div>
      {sub && <div style={{ color: '#3A4560', fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  color: '#00D4FF', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 14
}
const labelStyle: React.CSSProperties = {
  display: 'block', color: '#6B7A99', fontSize: 11, marginBottom: 4, fontWeight: 600
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#111827', border: '1px solid #1E2A42', borderRadius: 6,
  padding: '8px 10px', color: '#E8EDF5', fontSize: 13, fontFamily: 'monospace',
  outline: 'none', boxSizing: 'border-box',
}
const tdStyle: React.CSSProperties = {
  padding: '7px 10px', color: '#E8EDF5', fontFamily: 'monospace'
}
