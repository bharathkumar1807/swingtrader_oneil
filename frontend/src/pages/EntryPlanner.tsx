import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { tradesApi, stocksApi } from '../services/api'
import { useStore } from '../store/useStore'

const PATTERNS = ['Cup with Handle', 'Double Bottom', 'Flat Base', 'VCP', 'High Tight Flag']
const MARKET_STATES = ['Confirmed Uptrend', 'Uptrend Under Pressure', 'Rally Attempt', 'Market in Correction']

export default function EntryPlanner() {
  const { currentSetup: setup, updateSetup } = useStore()
  const [calc, setCalc] = useState<any>(null)
  const [snapshot, setSnapshot] = useState<any>(null)
  const [suggest, setSuggest] = useState<any>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)

  // Fetch live price when symbol changes
  useEffect(() => {
    if (setup.symbol.length >= 1) {
      const timer = setTimeout(async () => {
        try {
          const res = await stocksApi.getSnapshot(setup.symbol)
          setSnapshot(res.data)
          if (!setup.entryPrice) {
            updateSetup({ entryPrice: res.data.latestPrice, stopLoss: +(res.data.latestPrice * 0.92).toFixed(2) })
          }
        } catch {}
      }, 600)
      return () => clearTimeout(timer)
    }
    setSuggest(null)
  }, [setup.symbol])

  const fetchSuggestion = async () => {
    if (!setup.symbol) return
    setSuggestLoading(true)
    try {
      const res = await stocksApi.getAutoSuggest(setup.symbol)
      setSuggest(res.data)
    } catch {
      toast.error('Could not fetch suggestion')
    } finally {
      setSuggestLoading(false)
    }
  }

  const applySuggestion = () => {
    if (!suggest) return
    updateSetup({ entryPrice: suggest.suggestedEntry, stopLoss: suggest.suggestedStop })
    toast.success('Entry & stop applied!')
  }

  // Auto-calculate position size
  useEffect(() => {
    if (setup.entryPrice && setup.stopLoss && setup.accountSize && setup.riskPercent) {
      tradesApi.calculate({
        accountSize: setup.accountSize,
        riskPercent: setup.riskPercent,
        entryPrice: setup.entryPrice,
        stopLoss: setup.stopLoss,
      }).then(res => {
        setCalc(res.data)
        updateSetup({ shares: res.data.shares })
      }).catch(() => {})
    }
  }, [setup.entryPrice, setup.stopLoss, setup.accountSize, setup.riskPercent])

  const createSetupMutation = useMutation({
    mutationFn: () => tradesApi.createSetup({
      ...setup,
      isPaperTrade: true,
    }),
    onSuccess: () => toast.success(`Trade setup created for ${setup.symbol} ✓`),
    onError: () => toast.error('Failed to create setup'),
  })

  const chase = snapshot && setup.entryPrice
    ? ((setup.entryPrice - snapshot.latestPrice) / snapshot.latestPrice * 100).toFixed(1)
    : null

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24, letterSpacing: '-0.02em' }}>Entry Planner</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left — Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Symbol + Live Price */}
          <Card title="Stock">
            <label style={labelStyle}>Symbol</label>
            <input value={setup.symbol} onChange={e => updateSetup({ symbol: e.target.value.toUpperCase() })}
              placeholder="AAPL" style={inputStyle} />
            {snapshot && (
              <>
                <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                  <div style={statBox}>
                    <div style={statLabel}>Live Price</div>
                    <div style={{ ...statValue, color: '#00D4FF' }}>${snapshot.latestPrice?.toFixed(2)}</div>
                  </div>
                  <div style={statBox}>
                    <div style={statLabel}>Change</div>
                    <div style={{ ...statValue, color: snapshot.changePct >= 0 ? '#00E676' : '#FF4444' }}>
                      {snapshot.changePct >= 0 ? '+' : ''}{snapshot.changePct?.toFixed(2)}%
                    </div>
                  </div>
                  <div style={statBox}>
                    <div style={statLabel}>Volume</div>
                    <div style={statValue}>{(snapshot.volume / 1_000_000).toFixed(1)}M</div>
                  </div>
                </div>

                <button onClick={fetchSuggestion} disabled={suggestLoading} style={{
                  marginTop: 12, width: '100%', padding: '9px 0',
                  background: suggestLoading ? '#1E2A42' : '#00D4FF18',
                  border: '1px solid #00D4FF55', borderRadius: 8,
                  color: '#00D4FF', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>
                  {suggestLoading ? 'Analyzing chart data...' : 'Auto-Suggest Entry & Stop'}
                </button>

                {suggest && (
                  <div style={{ marginTop: 12, background: '#111827', border: '1px solid #1E2A42', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#00D4FF', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 10 }}>SUGGESTED LEVELS</div>

                    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      <div style={{ ...statBox, flex: 1, border: '1px solid #00E67633' }}>
                        <div style={statLabel}>Entry (50-day pivot high)</div>
                        <div style={{ ...statValue, color: '#00E676', fontSize: 18 }}>${suggest.suggestedEntry?.toFixed(2)}</div>
                        <div style={{ color: '#6B7A99', fontSize: 10, marginTop: 2 }}>breakout level · {suggest.pivotDaysAgo}d ago</div>
                      </div>
                      <div style={{ ...statBox, flex: 1, border: '1px solid #FF444433' }}>
                        <div style={statLabel}>Stop (20-day base low)</div>
                        <div style={{ ...statValue, color: '#FF4444', fontSize: 18 }}>${suggest.suggestedStop?.toFixed(2)}</div>
                        <div style={{ color: '#6B7A99', fontSize: 10, marginTop: 2 }}>pattern-fail level</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      <SuggestRow
                        label="Risk between levels"
                        value={`${suggest.riskPct}%`}
                        ok={suggest.isValidRisk}
                        okText="within 8% — tight base"
                        warnText="too wide — base is loose"
                      />
                      <SuggestRow
                        label="Chase risk"
                        value={suggest.chasePct > 0 ? `+${suggest.chasePct}% above pivot` : `${suggest.chasePct}% (not yet at pivot)`}
                        ok={!suggest.isChasing}
                        okText="safe entry zone"
                        warnText="O'Neil rule: max 5% above pivot"
                      />
                      <SuggestRow
                        label="Volume today"
                        value={`${suggest.volumeRatio?.toFixed(1)}× avg`}
                        ok={suggest.volumeRatio >= 1.0}
                        okText="above average"
                        warnText="below average — wait for volume"
                      />
                    </div>

                    <button onClick={applySuggestion} style={{
                      width: '100%', padding: '9px 0',
                      background: '#00E676', color: '#000',
                      fontWeight: 900, fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer',
                    }}>
                      Apply These Levels
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Pattern */}
          <Card title="Pattern">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PATTERNS.map(p => (
                <button key={p} onClick={() => updateSetup({ pattern: p })}
                  style={{
                    padding: '6px 12px', borderRadius: 6, border: '1px solid',
                    borderColor: setup.pattern === p ? '#00D4FF' : '#1E2A42',
                    background: setup.pattern === p ? '#00D4FF22' : 'transparent',
                    color: setup.pattern === p ? '#00D4FF' : '#6B7A99',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}>{p}</button>
              ))}
            </div>
          </Card>

          {/* Market Direction */}
          <Card title="Market Direction">
            {MARKET_STATES.map(m => (
              <button key={m} onClick={() => updateSetup({ marketDirection: m })}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', borderRadius: 6, border: '1px solid',
                  borderColor: setup.marketDirection === m ? '#00E676' : '#1E2A42',
                  background: setup.marketDirection === m ? '#00E67615' : 'transparent',
                  color: setup.marketDirection === m ? '#00E676' : '#6B7A99',
                  cursor: 'pointer', fontSize: 13, marginBottom: 6,
                }}>{m}</button>
            ))}
          </Card>

          {/* Notes */}
          <Card title="Notes">
            <textarea value={setup.notes} onChange={e => updateSetup({ notes: e.target.value })}
              placeholder="Why this stock? What does the chart say?" rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </Card>
        </div>

        {/* Right — Position Sizing */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Position Sizing">
            {[
              ['Account Size ($)', 'accountSize'],
              ['Risk per Trade (%)', 'riskPercent'],
              ['Entry / Buy Point ($)', 'entryPrice'],
              ['Stop Loss ($)', 'stopLoss'],
            ].map(([label, key]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={labelStyle}>{label}</label>
                <input type="number" value={(setup as any)[key] || ''}
                  onChange={e => updateSetup({ [key]: parseFloat(e.target.value) })}
                  style={inputStyle} />
              </div>
            ))}

            {chase && parseFloat(chase) > 5 && (
              <div style={{ background: '#FF444422', border: '1px solid #FF4444', borderRadius: 8, padding: '10px 12px', marginTop: 8 }}>
                <span style={{ color: '#FF4444', fontWeight: 700 }}>⚠ Chase Alert — {chase}% above pivot. O'Neil rule: max 5%.</span>
              </div>
            )}
          </Card>

          {/* Calculated Output */}
          {calc && (
            <Card title="Calculated Levels">
              {calc.stopLossPct > 8 && (
                <div style={{ background: '#FFD60011', border: '1px solid #FFD60044', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                  <div style={{ color: '#FFD600', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                    Wide base ({calc.stopLossPct?.toFixed(1)}% to chart stop)
                  </div>
                  <div style={{ color: '#A89040', fontSize: 12, lineHeight: 1.5 }}>
                    Position sized down to {calc.shares} shares so your dollar risk stays at ${calc.dollarRisk?.toFixed(0)}.
                    Hard exit at −8% (${(calc.entryPrice * 0.92)?.toFixed(2)}) if price drops before reaching your chart stop.
                  </div>
                </div>
              )}
              {[
                ['Shares', calc.shares, '#E8EDF5'],
                ['Position Size', `$${calc.positionSize?.toLocaleString()}`, '#E8EDF5'],
                ['Dollar Risk', `$${calc.dollarRisk?.toFixed(0)}`, '#FFD600'],
                ['Risk per Share', `$${calc.riskPerShare?.toFixed(2)}`, '#FFD600'],
                [`Stop Loss (${calc.stopLossPct?.toFixed(1)}% loss)`, `$${calc.stopLoss?.toFixed(2)}`, calc.stopLossPct > 8 ? '#FF2222' : '#FF4444'],
                ['Target 1R', `$${calc.target1R?.toFixed(2)}`, '#00D4FF'],
                ['Target 20%', `$${calc.target20Pct?.toFixed(2)}`, '#00E676'],
                ['Target 3R', `$${calc.target3R?.toFixed(2)}`, '#B388FF'],
              ].map(([label, value, color]) => (
                <div key={label as string} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px solid #1E2A42',
                }}>
                  <span style={{ color: '#6B7A99', fontSize: 13 }}>{label}</span>
                  <span style={{ color: color as string, fontWeight: 700, fontFamily: 'monospace' }}>{value}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Trade Checklist */}
          {(calc || suggest) && (
            <TradeChecklist
              stopLossPct={calc?.stopLossPct}
              riskPct={suggest?.riskPct}
              isChasing={suggest ? suggest.isChasing : (chase ? parseFloat(chase) > 5 : null)}
              volumeRatio={suggest?.volumeRatio ?? null}
              marketDirection={setup.marketDirection}
              pattern={setup.pattern}
            />
          )}

          <button
            onClick={() => createSetupMutation.mutate()}
            disabled={!setup.symbol || !setup.entryPrice || createSetupMutation.isPending}
            style={{
              background: '#00D4FF', color: '#000', fontWeight: 900, fontSize: 15,
              padding: '14px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
              opacity: !setup.symbol || !setup.entryPrice ? 0.4 : 1,
            }}>
            {createSetupMutation.isPending ? 'Creating...' : '+ Create Trade Setup'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared sub-components ─────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }}>
      <div style={{ color: '#00D4FF', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 14 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  )
}

function SuggestRow({ label, value, ok, okText, warnText }: {
  label: string; value: string; ok: boolean; okText: string; warnText: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: '#6B7A99' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#E8EDF5' }}>{value}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: ok ? '#00E67622' : '#FF444422',
          color: ok ? '#00E676' : '#FF4444',
        }}>{ok ? okText : warnText}</span>
      </span>
    </div>
  )
}

// ─── Trade Checklist ──────────────────────────────────────────
type CheckState = 'pass' | 'fail' | 'warn' | 'unknown'

function TradeChecklist({ stopLossPct, riskPct, isChasing, volumeRatio, marketDirection, pattern }: {
  stopLossPct?: number
  riskPct?: number
  isChasing: boolean | null
  volumeRatio: number | null
  marketDirection: string
  pattern: string
}) {
  const stopPct = stopLossPct ?? riskPct

  // ── Rule evaluations ────────────────────────────────────────
  const stopCheck = (): { state: CheckState; detail: string } => {
    if (stopPct == null) return { state: 'unknown', detail: 'Enter entry & stop to evaluate' }
    if (stopPct <= 8)    return { state: 'pass',    detail: `${stopPct.toFixed(1)}% — tight base` }
    if (stopPct <= 12)   return { state: 'warn',    detail: `${stopPct.toFixed(1)}% — borderline, reduce size` }
    return                      { state: 'fail',    detail: `${stopPct.toFixed(1)}% — too wide, skip this` }
  }

  const rrCheck = (): { state: CheckState; detail: string } => {
    if (stopPct == null) return { state: 'unknown', detail: 'Needs entry & stop' }
    const rr = 20 / stopPct
    if (rr >= 2.5) return { state: 'pass', detail: `${rr.toFixed(1)}:1 — excellent` }
    if (rr >= 2.0) return { state: 'pass', detail: `${rr.toFixed(1)}:1 — acceptable` }
    if (rr >= 1.5) return { state: 'warn', detail: `${rr.toFixed(1)}:1 — tight, need high win rate` }
    return               { state: 'fail', detail: `${rr.toFixed(1)}:1 — not worth the risk` }
  }

  const chaseCheck = (): { state: CheckState; detail: string } => {
    if (isChasing === null) return { state: 'unknown', detail: 'Run auto-suggest to check' }
    if (!isChasing)         return { state: 'pass',    detail: 'Within 5% of pivot — safe zone' }
    return                         { state: 'fail',    detail: 'Over 5% above pivot — chasing!' }
  }

  const volumeCheck = (): { state: CheckState; detail: string } => {
    if (volumeRatio === null) return { state: 'unknown', detail: 'Run auto-suggest to check' }
    if (volumeRatio >= 1.5)   return { state: 'pass',    detail: `${volumeRatio.toFixed(1)}× avg — strong confirmation` }
    if (volumeRatio >= 1.0)   return { state: 'pass',    detail: `${volumeRatio.toFixed(1)}× avg — above average` }
    if (volumeRatio >= 0.75)  return { state: 'warn',    detail: `${volumeRatio.toFixed(1)}× avg — light, wait for volume` }
    return                           { state: 'fail',    detail: `${volumeRatio.toFixed(1)}× avg — no conviction` }
  }

  const marketCheck = (): { state: CheckState; detail: string } => {
    if (!marketDirection) return { state: 'unknown', detail: 'Select market direction' }
    if (marketDirection === 'Confirmed Uptrend')
      return { state: 'pass', detail: 'Best time to buy — full position size' }
    if (marketDirection === 'Uptrend Under Pressure')
      return { state: 'warn', detail: 'Cut position size in half, be selective' }
    if (marketDirection === 'Rally Attempt')
      return { state: 'warn', detail: 'Wait for follow-through day before buying' }
    return { state: 'fail', detail: "O'Neil rule: go to cash, don't buy in corrections" }
  }

  const patternCheck = (): { state: CheckState; detail: string } => {
    if (!pattern) return { state: 'unknown', detail: 'Select a chart pattern' }
    return { state: 'pass', detail: pattern }
  }

  const checks = [
    { label: 'Stop distance ≤ 8%',        ...stopCheck() },
    { label: 'R:R ratio ≥ 2:1 (to 20%)',  ...rrCheck() },
    { label: 'Not chasing pivot',          ...chaseCheck() },
    { label: 'Volume above average',       ...volumeCheck() },
    { label: 'Market behavior',            ...marketCheck() },
    { label: 'Chart pattern identified',   ...patternCheck() },
  ]

  const passed  = checks.filter(c => c.state === 'pass').length
  const failed  = checks.filter(c => c.state === 'fail').length
  const warned  = checks.filter(c => c.state === 'warn').length
  const known   = checks.filter(c => c.state !== 'unknown').length

  // Market correction is an automatic skip regardless of other scores
  const marketFailed = marketCheck().state === 'fail'

  const verdict = (): { label: string; color: string; bg: string } => {
    if (known === 0) return { label: 'Fill in the details above', color: '#6B7A99', bg: '#6B7A9915' }
    if (marketFailed) return { label: 'SKIP — Market in correction', color: '#FF4444', bg: '#FF444415' }
    if (failed >= 2)  return { label: 'SKIP THIS SETUP', color: '#FF4444', bg: '#FF444415' }
    if (failed === 1 || warned >= 2) return { label: 'PROCEED WITH CAUTION', color: '#FFD600', bg: '#FFD60015' }
    if (passed >= 4)  return { label: 'LOOKS GOOD — TRADE IT', color: '#00E676', bg: '#00E67615' }
    return { label: 'NEEDS MORE CONFIRMATION', color: '#FFD600', bg: '#FFD60015' }
  }

  const v = verdict()

  return (
    <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }}>
      <div style={{ color: '#00D4FF', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 14 }}>
        TRADE CHECKLIST
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {checks.map(c => <CheckRow key={c.label} label={c.label} state={c.state} detail={c.detail} />)}
      </div>

      {/* Score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#6B7A99' }}>
          {passed} passed · {warned} caution · {failed} failed
        </div>
        <div style={{ fontSize: 11, color: '#3A4560' }}>
          {known}/{checks.length} evaluated
        </div>
      </div>

      {/* Verdict */}
      <div style={{
        background: v.bg, border: `1px solid ${v.color}33`,
        borderRadius: 8, padding: '10px 14px', textAlign: 'center',
        fontWeight: 800, fontSize: 13, color: v.color, letterSpacing: '0.04em',
      }}>
        {v.label}
      </div>
    </div>
  )
}

function CheckRow({ label, state, detail }: { label: string; state: CheckState; detail: string }) {
  const cfg = {
    pass:    { icon: '✓', color: '#00E676', bg: '#00E67618' },
    fail:    { icon: '✗', color: '#FF4444', bg: '#FF444418' },
    warn:    { icon: '⚠', color: '#FFD600', bg: '#FFD60018' },
    unknown: { icon: '·', color: '#3A4560', bg: 'transparent' },
  }[state]

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 4, background: cfg.bg,
          color: cfg.color, fontSize: 11, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {cfg.icon}
        </span>
        <span style={{ color: '#6B7A99', fontSize: 12 }}>{label}</span>
      </div>
      <span style={{ color: cfg.color, fontSize: 11, fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
        {detail}
      </span>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', color: '#6B7A99', fontSize: 11, marginBottom: 4, fontWeight: 600 }
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#111827', border: '1px solid #1E2A42',
  borderRadius: 6, padding: '8px 12px', color: '#E8EDF5', fontSize: 14,
  fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
}
const statBox: React.CSSProperties = { background: '#111827', borderRadius: 6, padding: '8px 12px', flex: 1 }
const statLabel: React.CSSProperties = { color: '#6B7A99', fontSize: 10, marginBottom: 4 }
const statValue: React.CSSProperties = { fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#E8EDF5' }
