import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { positionsApi, tradesApi, ordersApi } from '../services/api'

const EXIT_REASONS = ['StopHit', 'Rule20Pct', 'Distribution', 'Trailing', 'Manual']
const GRADES = ['A', 'B', 'C']

interface CloseTarget {
  positionId: number
  symbol: string
  currentPrice: number
  shares: number
  entryPrice: number
}

export default function Positions() {
  const qc = useQueryClient()
  const [closeTarget, setCloseTarget] = useState<CloseTarget | null>(null)
  const [closeForm, setCloseForm] = useState({ exitPrice: '', exitReason: 'Manual', grade: 'B', notes: '' })

  const { data: setupsRes } = useQuery({ queryKey: ['setups'], queryFn: () => tradesApi.getSetups() })
  const { data: positionsRes, isLoading } = useQuery({ queryKey: ['positions'], queryFn: () => positionsApi.getOpen() })
  const { data: accountRes } = useQuery({ queryKey: ['account'], queryFn: () => ordersApi.getAccount(), refetchInterval: 60_000 })

  const activateMutation = useMutation({
    mutationFn: (setupId: number) => tradesApi.activateTrade(setupId),
    onSuccess: () => {
      toast.success('Order placed on Alpaca ✓')
      qc.invalidateQueries({ queryKey: ['setups'] })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
    onError: (e: any) => toast.error(e?.response?.data || 'Failed to place order'),
  })

  const syncMutation = useMutation({
    mutationFn: (positionId: number) => ordersApi.syncPosition(positionId),
    onSuccess: (res) => {
      const d = res.data
      if (d.status === 'Open') toast.success(`Filled at $${d.fillPrice?.toFixed(2)} ✓`)
      else toast(`Still pending — Alpaca status: ${d.alpacaStatus}`, { icon: '🔄' })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
    onError: () => toast.error('Sync failed'),
  })

  const closeMutation = useMutation({
    mutationFn: (dto: any) => tradesApi.closeTrade(dto),
    onSuccess: () => {
      toast.success('Position closed — logged to journal ✓')
      setCloseTarget(null)
      qc.invalidateQueries({ queryKey: ['positions'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['journal'] })
    },
    onError: () => toast.error('Failed to close position'),
  })

  const allSetups: any[] = setupsRes?.data ?? []
  const allPositions: any[] = positionsRes?.data ?? []
  const plannedSetups = allSetups.filter(s => s.status === 'Planned')
  const pendingPositions = allPositions.filter(p => p.position.status === 'PendingFill')
  const openPositions = allPositions.filter(p => p.position.status === 'Open')
  const acc = accountRes?.data

  function openCloseModal(item: any) {
    setCloseTarget({
      positionId: item.position.id,
      symbol: item.position.symbol,
      currentPrice: item.currentPrice,
      shares: item.position.shares,
      entryPrice: item.position.fillPrice ?? item.position.entryPrice,
    })
    setCloseForm({ exitPrice: item.currentPrice.toFixed(2), exitReason: 'Manual', grade: 'B', notes: '' })
  }

  function submitClose() {
    if (!closeTarget) return
    const exitPrice = parseFloat(closeForm.exitPrice)
    if (!exitPrice) return toast.error('Enter an exit price')
    closeMutation.mutate({
      positionId: closeTarget.positionId,
      exitPrice,
      exitReason: closeForm.exitReason,
      grade: closeForm.grade,
      notes: closeForm.notes,
    })
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>Active Positions</h1>
        <span style={{ fontSize: 12, color: '#00D4FF', fontWeight: 700 }}>PAPER TRADING</span>
      </div>

      {/* Account Summary */}
      {acc && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24,
        }}>
          {[
            { label: 'Equity', value: `$${Number(acc.equity).toLocaleString()}`, color: '#E8EDF5' },
            { label: 'Cash', value: `$${Number(acc.cash).toLocaleString()}`, color: '#E8EDF5' },
            { label: 'Buying Power', value: `$${Number(acc.buyingPower).toLocaleString()}`, color: '#00D4FF' },
            { label: 'Account Status', value: acc.accountStatus, color: '#00E676' },
          ].map(s => (
            <div key={s.label} style={card}>
              <div style={sectionLabel}>{s.label}</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 18, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Planned Setups — ready to activate */}
      {plannedSetups.length > 0 && (
        <Section title="PLANNED — READY TO ACTIVATE">
          {plannedSetups.map((s: any) => {
            const risk = s.entryPrice - s.stopLoss
            return (
              <Row key={s.id}>
                <div style={{ minWidth: 60 }}>
                  <div style={symbolText}>{s.symbol}</div>
                  <div style={subText}>{s.pattern}</div>
                </div>
                <PillGroup>
                  <Pill label="Entry" value={`$${s.entryPrice}`} color="#00D4FF" />
                  <Pill label="Stop" value={`$${s.stopLoss}`} color="#FF4444" />
                  <Pill label="Risk/sh" value={`$${risk.toFixed(2)}`} color="#FFD600" />
                  <Pill label="Shares" value={s.shares} color="#E8EDF5" />
                  <Pill label="Pos Size" value={`$${s.positionSize?.toLocaleString()}`} color="#E8EDF5" />
                </PillGroup>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <ScoreBadge label="C" score={s.canslimScore} max={5} />
                  <ScoreBadge label="M" score={s.minerviniScore} max={7} />
                </div>
                <button
                  onClick={() => activateMutation.mutate(s.id)}
                  disabled={activateMutation.isPending}
                  style={activateBtn}>
                  {activateMutation.isPending ? '...' : '▶ Place Order'}
                </button>
              </Row>
            )
          })}
        </Section>
      )}

      {/* Pending Fill */}
      {pendingPositions.length > 0 && (
        <Section title="PENDING FILL — AWAITING ALPACA">
          {pendingPositions.map((item: any) => {
            const p = item.position
            const distFromEntry = item.currentPrice && p.entryPrice
              ? ((item.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1)
              : null
            return (
              <Row key={p.id}>
                <div style={{ minWidth: 60 }}>
                  <div style={symbolText}>{p.symbol}</div>
                  <div style={subText}>{p.shares} shares</div>
                </div>
                <PillGroup>
                  <Pill label="Limit Buy" value={`$${p.entryPrice}`} color="#00D4FF" />
                  <Pill label="Stop" value={`$${p.stopLoss}`} color="#FF4444" />
                  <Pill label="Current" value={`$${item.currentPrice?.toFixed(2)}`} color="#E8EDF5" />
                  {distFromEntry !== null && (
                    <Pill
                      label="vs Entry"
                      value={`${Number(distFromEntry) > 0 ? '+' : ''}${distFromEntry}%`}
                      color={Number(distFromEntry) <= 0 ? '#00E676' : '#FFD600'}
                    />
                  )}
                </PillGroup>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <StatusBadge status={p.alpacaStatus} />
                  {p.alpacaStopOrderId && (
                    <div style={{ fontSize: 10, color: '#3A4560' }}>Stop: Held</div>
                  )}
                </div>
                <button
                  onClick={() => syncMutation.mutate(p.id)}
                  disabled={syncMutation.isPending}
                  style={syncBtn}>
                  {syncMutation.isPending ? '...' : '↻ Check Fill'}
                </button>
              </Row>
            )
          })}
        </Section>
      )}

      {/* Open Positions */}
      <Section title="OPEN POSITIONS">
        {isLoading ? (
          <div style={{ color: '#3A4560', padding: 32, textAlign: 'center' }}>Loading...</div>
        ) : openPositions.length === 0 ? (
          <div style={{ color: '#3A4560', padding: 32, textAlign: 'center' }}>
            No open positions — activate a setup above or create one in Entry Planner
          </div>
        ) : openPositions.map((item: any) => {
          const p = item.position
          const pnlColor = item.unrealizedPnL >= 0 ? '#00E676' : '#FF4444'
          return (
            <Row key={p.id}>
              <div style={{ minWidth: 60 }}>
                <div style={symbolText}>{p.symbol}</div>
                <div style={subText}>{p.shares} sh · {item.daysHeld}d</div>
              </div>
              <PillGroup>
                <Pill label="Entry" value={`$${(p.fillPrice ?? p.entryPrice).toFixed(2)}`} color="#E8EDF5" />
                <Pill label="Current" value={`$${item.currentPrice?.toFixed(2)}`} color="#00D4FF" />
                <Pill label="Stop" value={`$${p.stopLoss}`} color="#FF4444" />
                <Pill label="P&L" value={`${item.unrealizedPnL >= 0 ? '+' : ''}$${item.unrealizedPnL?.toFixed(0)}`} color={pnlColor} />
                <Pill label="%" value={`${item.unrealizedPnLPct >= 0 ? '+' : ''}${item.unrealizedPnLPct?.toFixed(2)}%`} color={pnlColor} />
              </PillGroup>
              <div style={{ display: 'flex', gap: 6 }}>
                {item.isAtTarget20 && <Badge text="🎯 20%" color="#00E676" />}
                {item.isNearStop && <Badge text="⚠ STOP" color="#FF4444" />}
              </div>
              <button onClick={() => openCloseModal(item)} style={closeBtn}>✕ Close</button>
            </Row>
          )
        })}
      </Section>

      {/* Close Trade Modal */}
      {closeTarget && (
        <div style={overlay} onClick={() => setCloseTarget(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>
              Close {closeTarget.symbol}
            </div>
            <div style={{ color: '#6B7A99', fontSize: 13, marginBottom: 20 }}>
              {closeTarget.shares} shares · entry ${closeTarget.entryPrice.toFixed(2)} · current ${closeTarget.currentPrice.toFixed(2)}
            </div>

            <FieldLabel>Exit Price ($)</FieldLabel>
            <input
              type="number"
              value={closeForm.exitPrice}
              onChange={e => setCloseForm(f => ({ ...f, exitPrice: e.target.value }))}
              style={inputStyle}
            />

            {closeForm.exitPrice && (
              <div style={{ marginBottom: 16, fontSize: 13 }}>
                {(() => {
                  const exit = parseFloat(closeForm.exitPrice)
                  const pnl = (exit - closeTarget.entryPrice) * closeTarget.shares
                  const pnlPct = (exit - closeTarget.entryPrice) / closeTarget.entryPrice * 100
                  const color = pnl >= 0 ? '#00E676' : '#FF4444'
                  return (
                    <div style={{ color, fontFamily: 'monospace', fontWeight: 700 }}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(0)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                    </div>
                  )
                })()}
              </div>
            )}

            <FieldLabel>Exit Reason</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {EXIT_REASONS.map(r => (
                <button key={r} onClick={() => setCloseForm(f => ({ ...f, exitReason: r }))}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: '1px solid', cursor: 'pointer',
                    borderColor: closeForm.exitReason === r ? '#00D4FF' : '#1E2A42',
                    background: closeForm.exitReason === r ? '#00D4FF22' : 'transparent',
                    color: closeForm.exitReason === r ? '#00D4FF' : '#6B7A99',
                  }}>{r}</button>
              ))}
            </div>

            <FieldLabel>Trade Grade</FieldLabel>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {GRADES.map(g => (
                <button key={g} onClick={() => setCloseForm(f => ({ ...f, grade: g }))}
                  style={{
                    width: 40, height: 40, borderRadius: 8, fontSize: 16, fontWeight: 900,
                    border: '2px solid', cursor: 'pointer',
                    borderColor: closeForm.grade === g ? gradeColor(g) : '#1E2A42',
                    background: closeForm.grade === g ? gradeColor(g) + '22' : 'transparent',
                    color: closeForm.grade === g ? gradeColor(g) : '#6B7A99',
                  }}>{g}</button>
              ))}
            </div>

            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={closeForm.notes}
              onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="What worked? What didn't? Lessons learned."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, marginBottom: 20 }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCloseTarget(null)}
                style={{ flex: 1, padding: '12px', borderRadius: 8, border: '1px solid #1E2A42', background: 'transparent', color: '#6B7A99', cursor: 'pointer', fontWeight: 700 }}>
                Cancel
              </button>
              <button onClick={submitClose} disabled={closeMutation.isPending}
                style={{ flex: 2, padding: '12px', borderRadius: 8, border: 'none', background: '#FF4444', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>
                {closeMutation.isPending ? 'Closing...' : '✕ Close Position & Market Sell'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <div style={{ ...sectionLabel, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '12px 0', borderBottom: '1px solid #1E2A42',
    }}>{children}</div>
  )
}

function PillGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>{children}</div>
}

function Pill({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ background: '#111827', borderRadius: 6, padding: '5px 10px' }}>
      <div style={{ fontSize: 9, color: '#3A4560', fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color }}>{value}</div>
    </div>
  )
}

function ScoreBadge({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = score / max
  const color = pct >= 0.7 ? '#00E676' : pct >= 0.5 ? '#FFD600' : '#FF4444'
  return (
    <div style={{ textAlign: 'center', background: '#111827', borderRadius: 6, padding: '5px 8px', minWidth: 36 }}>
      <div style={{ fontSize: 9, color: '#3A4560', fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color }}>{score}/{max}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'Filled' ? '#00E676' : status === 'Accepted' || status === 'New' ? '#FFD600' : '#6B7A99'
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color, background: color + '22', padding: '3px 8px', borderRadius: 4, display: 'inline-block' }}>
      {status}
    </div>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ background: color + '22', color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {text}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#6B7A99', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{children}</div>
}

function gradeColor(g: string) {
  return g === 'A' ? '#00E676' : g === 'B' ? '#FFD600' : '#FF4444'
}

// ─── Styles ───────────────────────────────────────────────────
const card: React.CSSProperties = { background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#00D4FF' }
const symbolText: React.CSSProperties = { fontFamily: 'monospace', fontWeight: 900, fontSize: 16 }
const subText: React.CSSProperties = { color: '#6B7A99', fontSize: 12, marginTop: 2 }

const activateBtn: React.CSSProperties = {
  background: '#00D4FF', color: '#000', fontWeight: 900, fontSize: 13,
  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
}
const syncBtn: React.CSSProperties = {
  background: '#FFD60022', color: '#FFD600', fontWeight: 700, fontSize: 13,
  padding: '8px 14px', borderRadius: 8, border: '1px solid #FFD60044', cursor: 'pointer', whiteSpace: 'nowrap',
}
const closeBtn: React.CSSProperties = {
  background: '#FF444422', color: '#FF4444', fontWeight: 700, fontSize: 13,
  padding: '8px 14px', borderRadius: 8, border: '1px solid #FF444444', cursor: 'pointer', whiteSpace: 'nowrap',
}
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#00000088', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const modal: React.CSSProperties = {
  background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 16,
  padding: 28, width: 420, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#111827', border: '1px solid #1E2A42',
  borderRadius: 6, padding: '9px 12px', color: '#E8EDF5', fontSize: 14,
  fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box', marginBottom: 16,
}
