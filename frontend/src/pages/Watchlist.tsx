import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { watchlistApi, stocksApi } from '../services/api'
import { useStore } from '../store/useStore'
import { getCapTier } from '../utils/capTier'

const PATTERNS = ['Cup with Handle', 'Double Bottom', 'Flat Base', 'VCP', 'High Tight Flag']

// ─── Volume confidence based on US market time ────────────────
function getVolumeConfidence() {
  // Get current time in US Eastern (handles DST automatically)
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
  const [h, m] = etStr.split(':').map(Number)
  const nowMin = h * 60 + m

  const open  = 9 * 60 + 30   // 9:30 AM ET
  const close = 16 * 60        // 4:00 PM ET

  if (nowMin < open)  return { pct: 0,   label: 'Pre-market',    detail: 'Market not open yet — volume unconfirmed',   color: '#3A4560', barColor: '#3A4560' }
  if (nowMin >= close) return { pct: 100, label: 'Market closed', detail: 'Full day volume — highest confidence',        color: '#00E676', barColor: '#00E676' }

  const pct = Math.round(((nowMin - open) / (close - open)) * 100)

  if (pct < 15)  return { pct, label: 'Very early',      detail: `${pct}% of day traded — ignore volume column`,       color: '#FF4444', barColor: '#FF4444' }
  if (pct < 35)  return { pct, label: 'Low confidence',  detail: `${pct}% of day traded — volume still building`,      color: '#FF8C00', barColor: '#FF8C00' }
  if (pct < 60)  return { pct, label: 'Moderate',        detail: `${pct}% of day traded — decent signal`,              color: '#FFD600', barColor: '#FFD600' }
  if (pct < 85)  return { pct, label: 'Good',            detail: `${pct}% of day traded — reliable volume`,            color: '#A8E676', barColor: '#A8E676' }
  return               { pct, label: 'High confidence', detail: `${pct}% of day traded — volume fully confirmed`,      color: '#00E676', barColor: '#00E676' }
}

// ─── Readiness logic (mirrors EntryPlanner checklist) ─────────
type CheckState = 'pass' | 'fail' | 'warn' | 'unknown'

function evalReadiness(suggest: any, pattern: string, marketDirection: string) {
  const stopPct: number | null = suggest?.riskPct ?? null

  const stop: CheckState =
    stopPct == null ? 'unknown' : stopPct <= 8 ? 'pass' : stopPct <= 12 ? 'warn' : 'fail'

  const rr: CheckState =
    stopPct == null ? 'unknown'
    : (20 / stopPct) >= 2.0 ? 'pass'
    : (20 / stopPct) >= 1.5 ? 'warn'
    : 'fail'

  const chase: CheckState =
    suggest == null ? 'unknown' : suggest.isChasing ? 'fail' : 'pass'

  const vol: CheckState =
    suggest == null ? 'unknown'
    : suggest.volumeRatio >= 1.0 ? 'pass'
    : suggest.volumeRatio >= 0.75 ? 'warn'
    : 'fail'

  const market: CheckState =
    !marketDirection ? 'unknown'
    : marketDirection === 'Confirmed Uptrend' ? 'pass'
    : marketDirection === 'Market in Correction' ? 'fail'
    : 'warn'

  const pat: CheckState = pattern ? 'pass' : 'unknown'

  const checks = [stop, rr, chase, vol, market, pat]
  const passed  = checks.filter(c => c === 'pass').length
  const failed  = checks.filter(c => c === 'fail').length
  const warned  = checks.filter(c => c === 'warn').length
  const known   = checks.filter(c => c !== 'unknown').length

  const marketFailed = market === 'fail'
  const verdict =
    known === 0       ? 'unseen'
    : marketFailed    ? 'skip'
    : failed >= 2     ? 'skip'
    : failed === 1 || warned >= 2 ? 'watch'
    : passed >= 4     ? 'ready'
    : 'watch'

  return { passed, failed, warned, known, verdict, stopPct, volumeRatio: suggest?.volumeRatio ?? null }
}

export default function Watchlist() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const updateSetup = useStore(s => s.updateSetup)
  const marketDirection = useStore(s => s.marketDirection)

  const [addForm, setAddForm] = useState({ symbol: '', patternSeen: '', notes: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [snapshots, setSnapshots] = useState<Record<string, any>>({})
  const [minervini, setMinervini] = useState<Record<string, any>>({})
  const [suggests, setSuggests] = useState<Record<string, any>>({})
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [scanTime, setScanTime] = useState<Date | null>(null)

  const { data: watchlistRes, isLoading } = useQuery({
    queryKey: ['watchlist'],
    queryFn: () => watchlistApi.getAll(),
  })

  // Fetch live price + Minervini score for each watchlist item
  useEffect(() => {
    const items: any[] = watchlistRes?.data ?? []
    for (const item of items) {
      if (!snapshots[item.symbol]) {
        stocksApi.getSnapshot(item.symbol).then(r => {
          setSnapshots(prev => ({ ...prev, [item.symbol]: r.data }))
        }).catch(() => {})
        stocksApi.checkMinervini(item.symbol).then(r => {
          setMinervini(prev => ({ ...prev, [item.symbol]: r.data }))
        }).catch(() => {})
      }
    }
  }, [watchlistRes])

  const scanAll = async () => {
    const items: any[] = watchlistRes?.data ?? []
    if (!items.length) return
    setScanning(true)
    setSuggests({})
    await Promise.allSettled(
      items.map(item =>
        stocksApi.getAutoSuggest(item.symbol)
          .then(r => setSuggests(prev => ({ ...prev, [item.symbol]: r.data })))
          .catch(() => setSuggests(prev => ({ ...prev, [item.symbol]: null })))
      )
    )
    setScanning(false)
    setScanned(true)
    setScanTime(new Date())
    toast.success('Scan complete')
  }

  const addMutation = useMutation({
    mutationFn: () => watchlistApi.add(addForm),
    onSuccess: () => {
      toast.success(`${addForm.symbol} added ✓`)
      setAddForm({ symbol: '', patternSeen: '', notes: '' })
      setShowAdd(false)
      qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: () => toast.error('Failed to add'),
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => watchlistApi.remove(id),
    onSuccess: () => {
      toast.success('Removed')
      qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })

  function planEntry(item: any) {
    const snap = snapshots[item.symbol]
    const sug  = suggests[item.symbol]
    updateSetup({
      symbol:      item.symbol,
      pattern:     item.patternSeen || '',
      entryPrice:  sug?.suggestedEntry ?? snap?.latestPrice ?? 0,
      stopLoss:    sug?.suggestedStop  ?? (snap ? +(snap.latestPrice * 0.92).toFixed(2) : 0),
    })
    navigate('/entry')
    toast.success(`${item.symbol} loaded into Entry Planner`)
  }

  const items: any[] = watchlistRes?.data ?? []

  // Summary counts (only after scan)
  const readinessCounts = scanned ? items.reduce((acc, item) => {
    const v = evalReadiness(suggests[item.symbol], item.patternSeen, marketDirection).verdict
    acc[v] = (acc[v] ?? 0) + 1
    return acc
  }, {} as Record<string, number>) : null

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Watchlist</h1>
          <p style={{ color: '#6B7A99', margin: 0, fontSize: 13 }}>
            Shortlisted stocks — scan every morning to see which ones are ready to trade
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={scanAll}
            disabled={scanning || !items.length}
            style={{
              background: scanning ? '#1E2A42' : '#00E67622',
              color: scanning ? '#6B7A99' : '#00E676',
              fontWeight: 700, fontSize: 13, padding: '9px 18px',
              borderRadius: 8, border: '1px solid #00E67644', cursor: 'pointer',
            }}>
            {scanning ? `Scanning ${items.length} stocks...` : '⟳ Scan All Today'}
          </button>
          <button onClick={() => setShowAdd(s => !s)}
            style={{ background: '#00D4FF', color: '#000', fontWeight: 900, fontSize: 13, padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>
            + Add Stock
          </button>
        </div>
      </div>

      {/* Scan summary banner */}
      {readinessCounts && scanTime && (() => {
        const vc = getVolumeConfidence()
        const etTime = scanTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })
        return (
          <div style={{ marginBottom: 16 }}>
            {/* Readiness row */}
            <div style={{
              display: 'flex', gap: 12,
              background: '#161D2F', border: '1px solid #1E2A42',
              borderRadius: '10px 10px 0 0', padding: '12px 16px', alignItems: 'center',
            }}>
              <span style={{ color: '#6B7A99', fontSize: 12, fontWeight: 700 }}>TODAY'S SCAN</span>
              <div style={{ width: 1, height: 16, background: '#1E2A42' }} />
              {readinessCounts.ready > 0 && <span style={summaryChip('#00E676')}>{readinessCounts.ready} READY</span>}
              {readinessCounts.watch > 0 && <span style={summaryChip('#FFD600')}>{readinessCounts.watch} WATCHING</span>}
              {readinessCounts.skip  > 0 && <span style={summaryChip('#FF4444')}>{readinessCounts.skip} SKIP</span>}
              {!readinessCounts.ready && (
                <span style={{ color: '#6B7A99', fontSize: 12 }}>No stocks ready — wait for better setups</span>
              )}
              <span style={{ marginLeft: 'auto', color: '#3A4560', fontSize: 11 }}>
                Market: <span style={{
                  color: marketDirection === 'Confirmed Uptrend' ? '#00E676'
                    : marketDirection === 'Market in Correction' ? '#FF4444' : '#FFD600',
                  fontWeight: 700,
                }}>{marketDirection || 'not set'}</span>
              </span>
            </div>

            {/* Volume confidence row */}
            <div style={{
              background: '#111827', border: '1px solid #1E2A42', borderTop: 'none',
              borderRadius: '0 0 10px 10px', padding: '8px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ color: '#3A4560', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>VOLUME CONFIDENCE</span>
              {/* Progress bar */}
              <div style={{ flex: 1, height: 4, background: '#1E2A42', borderRadius: 2, overflow: 'hidden', maxWidth: 120 }}>
                <div style={{ height: '100%', width: `${vc.pct}%`, background: vc.barColor, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
              <span style={{ color: vc.color, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{vc.label}</span>
              <span style={{ color: '#3A4560', fontSize: 11 }}>{vc.detail}</span>
              <span style={{ marginLeft: 'auto', color: '#3A4560', fontSize: 11, flexShrink: 0 }}>
                Scanned {etTime} ET
              </span>
            </div>
          </div>
        )
      })()}

      {/* Add Form */}
      {showAdd && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <div style={fieldLabel}>Symbol</div>
              <input value={addForm.symbol}
                onChange={e => setAddForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                placeholder="AAPL" style={inputStyle} />
            </div>
            <div>
              <div style={fieldLabel}>Pattern Seen</div>
              <select value={addForm.patternSeen}
                onChange={e => setAddForm(f => ({ ...f, patternSeen: e.target.value }))}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— select —</option>
                {PATTERNS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div style={fieldLabel}>Notes</div>
              <input value={addForm.notes}
                onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Why watching..." style={inputStyle} />
            </div>
            <button onClick={() => addMutation.mutate()} disabled={!addForm.symbol || addMutation.isPending}
              style={{ background: '#00D4FF', color: '#000', fontWeight: 900, fontSize: 13, padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Add
            </button>
          </div>
        </div>
      )}

      <div style={card}>
        {isLoading ? (
          <div style={emptyState}>Loading watchlist...</div>
        ) : items.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>👁</div>
            <div>Watchlist is empty — add stocks above or from the Screener</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Symbol', 'Price', 'Change', 'Minervini', 'Pattern',
                  ...(scanned ? ['Stop %', 'Volume', 'R:R', 'Readiness'] : []),
                  ''].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items
                .map((item: any) => {
                  const r = scanned ? evalReadiness(suggests[item.symbol], item.patternSeen, marketDirection) : null
                  return { item, r }
                })
                // Sort: ready first, then watch, then skip, then unseen
                .sort((a, b) => {
                  const order = { ready: 0, watch: 1, skip: 2, unseen: 3 }
                  return (order[a.r?.verdict ?? 'unseen'] ?? 3) - (order[b.r?.verdict ?? 'unseen'] ?? 3)
                })
                .map(({ item, r }) => {
                  const snap = snapshots[item.symbol]
                  const mv   = minervini[item.symbol]
                  const changeColor = snap?.changePct >= 0 ? '#00E676' : '#FF4444'
                  const mvScore = mv?.score ?? null
                  const mvColor = mvScore >= 6 ? '#00E676' : mvScore >= 4 ? '#FFD600' : '#FF4444'

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #1E2A42' }}>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15 }}>{item.symbol}</span>
                          <CapBadge symbol={item.symbol} />
                        </div>
                        <div style={{ color: '#3A4560', fontSize: 10 }}>{new Date(item.addedAt).toLocaleDateString()}</div>
                      </td>
                      <td style={td}>
                        {snap
                          ? <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#00D4FF' }}>${snap.latestPrice?.toFixed(2)}</span>
                          : <span style={{ color: '#3A4560' }}>—</span>}
                      </td>
                      <td style={td}>
                        {snap
                          ? <span style={{ fontFamily: 'monospace', fontWeight: 700, color: changeColor }}>{snap.changePct >= 0 ? '+' : ''}{snap.changePct?.toFixed(2)}%</span>
                          : <span style={{ color: '#3A4560' }}>—</span>}
                      </td>
                      <td style={td}>
                        {mv ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ height: 5, width: 44, background: '#1E2A42', borderRadius: 3 }}>
                              <div style={{ height: '100%', width: `${(mvScore / 7) * 100}%`, background: mvColor, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: mvColor, fontSize: 12 }}>{mvScore}/7</span>
                          </div>
                        ) : <span style={{ color: '#3A4560' }}>...</span>}
                      </td>
                      <td style={td}>
                        {item.patternSeen
                          ? <span style={{ fontSize: 11, background: '#1E2A42', padding: '2px 7px', borderRadius: 4, color: '#6B7A99' }}>{item.patternSeen}</span>
                          : <span style={{ color: '#3A4560' }}>—</span>}
                      </td>

                      {/* Scan columns — only shown after scan */}
                      {scanned && (
                        <>
                          <td style={td}>
                            {r?.stopPct != null
                              ? <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: r.stopPct <= 8 ? '#00E676' : r.stopPct <= 12 ? '#FFD600' : '#FF4444' }}>
                                  {r.stopPct.toFixed(1)}%
                                </span>
                              : <span style={{ color: '#3A4560' }}>—</span>}
                          </td>
                          <td style={td}>
                            {r?.volumeRatio != null
                              ? <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: r.volumeRatio >= 1.0 ? '#00E676' : '#FF4444' }}>
                                  {r.volumeRatio.toFixed(1)}×
                                </span>
                              : <span style={{ color: '#3A4560' }}>—</span>}
                          </td>
                          <td style={td}>
                            {r?.stopPct != null
                              ? <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: (20 / r.stopPct) >= 2 ? '#00E676' : '#FF4444' }}>
                                  {(20 / r.stopPct).toFixed(1)}:1
                                </span>
                              : <span style={{ color: '#3A4560' }}>—</span>}
                          </td>
                          <td style={td}>
                            <ReadinessBadge verdict={r?.verdict ?? 'unseen'} passed={r?.passed ?? 0} />
                          </td>
                        </>
                      )}

                      <td style={{ ...td, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => planEntry(item)} style={planBtn}>📐 Plan</button>
                          <button onClick={() => removeMutation.mutate(item.id)} style={removeBtn}>✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}

        {/* Scan prompt footer */}
        {!scanned && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0 4px', color: '#3A4560', fontSize: 12 }}>
            Click "Scan All Today" to check which stocks pass today's rules
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Cap Tier Badge ───────────────────────────────────────────
function CapBadge({ symbol }: { symbol: string }) {
  const tier = getCapTier(symbol)
  const isMid = tier === 'MID'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
      padding: '2px 5px', borderRadius: 4,
      color: isMid ? '#FFD600' : '#4A5568',
      background: isMid ? '#FFD60018' : '#4A556818',
      border: `1px solid ${isMid ? '#FFD60040' : '#4A556840'}`,
      flexShrink: 0,
    }}>
      {isMid ? 'MID' : 'LARGE'}
    </span>
  )
}

// ─── Readiness Badge ──────────────────────────────────────────
function ReadinessBadge({ verdict, passed }: { verdict: string; passed: number }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    ready:  { label: 'READY',    color: '#00E676', bg: '#00E67620' },
    watch:  { label: 'WATCHING', color: '#FFD600', bg: '#FFD60020' },
    skip:   { label: 'SKIP',     color: '#FF4444', bg: '#FF444420' },
    unseen: { label: '—',        color: '#3A4560', bg: 'transparent' },
  }
  const c = cfg[verdict] ?? cfg.unseen

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        background: c.bg, color: c.color, fontWeight: 800, fontSize: 10,
        padding: '3px 8px', borderRadius: 5, letterSpacing: '0.06em',
      }}>
        {c.label}
      </span>
      {verdict !== 'unseen' && (
        <span style={{ color: '#3A4560', fontSize: 10 }}>{passed}/6</span>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────
const summaryChip = (color: string): React.CSSProperties => ({
  background: `${color}20`, color, fontWeight: 800, fontSize: 11,
  padding: '3px 10px', borderRadius: 5, letterSpacing: '0.06em',
})

const card: React.CSSProperties = { background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }
const emptyState: React.CSSProperties = { textAlign: 'center', padding: 48, color: '#6B7A99' }
const fieldLabel: React.CSSProperties = { color: '#6B7A99', fontSize: 11, fontWeight: 600, marginBottom: 6 }
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#111827', border: '1px solid #1E2A42',
  borderRadius: 6, padding: '8px 12px', color: '#E8EDF5', fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
}
const th: React.CSSProperties = { color: '#3A4560', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '0 12px 12px 0', textAlign: 'left' }
const td: React.CSSProperties = { padding: '10px 12px 10px 0', verticalAlign: 'middle' }
const planBtn: React.CSSProperties = {
  background: '#00D4FF22', color: '#00D4FF', fontWeight: 700, fontSize: 11,
  padding: '5px 10px', borderRadius: 6, border: '1px solid #00D4FF44', cursor: 'pointer',
}
const removeBtn: React.CSSProperties = {
  background: '#FF444422', color: '#FF4444', fontWeight: 700, fontSize: 11,
  padding: '5px 8px', borderRadius: 6, border: '1px solid #FF444444', cursor: 'pointer',
}
