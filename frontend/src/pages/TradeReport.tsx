import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts'
import toast from 'react-hot-toast'
import { importApi } from '../services/api'

// ─── Types ────────────────────────────────────────────────────
interface Challenge {
  id: number; name: string; startDate: string
  startingCapital: number; targetDays: number
  tradeCount: number; daysElapsed: number
}

interface Trade {
  id: number; symbol: string
  entryDate: string; exitDate: string
  entryPrice: number; exitPrice: number
  shares: number; pnLDollar: number; pnLPct: number; holdDays: number
}

interface Analysis {
  totalTrades: number; winners: number; losers: number; winRate: number
  totalPnL: number; totalPnLPct: number; avgGainPct: number; avgLossPct: number
  profitFactor: number; avgHoldDays: number; avgWinHoldDays: number
  avgLossHoldDays: number; maxDrawdownPct: number
  currentEquity: number; startingCapital: number
  equityCurve: { date: string; equity: number; symbol: string }[]
  flags: { type: string; title: string; detail: string }[]
  holdDistribution: { day1: number; day2to3: number; day4to7: number; day8to14: number; over14: number }
}

interface DailySetup {
  setupId: number; symbol: string; pattern: string
  plannedEntry: number; stopLoss: number; notes: string
  state: 'Planned' | 'Holding' | 'Closed'
  actualEntry?: number; actualExit?: number
  shares?: number; pnlDollar?: number; pnlPct?: number; holdDays?: number
  tradeId?: number
}

interface DailyUnplanned {
  symbol: string; state: 'Holding' | 'Closed'
  actualEntry?: number; actualExit?: number
  shares?: number; pnlDollar?: number; pnlPct?: number; holdDays?: number
}

interface DailyDate {
  date: string
  planned: DailySetup[]
  unplanned: DailyUnplanned[]
}

// ─── Main Page ────────────────────────────────────────────────
export default function TradeReport() {
  const [tab, setTab] = useState<'daily' | 'challenge'>('daily')

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Trade Report
        </h1>
        <p style={{ color: '#6B7A99', margin: '0 0 20px', fontSize: 13 }}>
          Plan setups in Entry Planner, execute on Robinhood, upload your CSV here to see what happened
        </p>
        <div style={{ display: 'flex', gap: 4, background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 10, padding: 4, width: 'fit-content' }}>
          {(['daily', 'challenge'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 13,
              background: tab === t ? '#00D4FF22' : 'transparent',
              color: tab === t ? '#00D4FF' : '#6B7A99',
            }}>
              {t === 'daily' ? 'Daily Log' : 'Challenges'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'daily' ? <DailyLogTab /> : <ChallengesTab />}
    </div>
  )
}

// ─── Daily Log Tab ────────────────────────────────────────────
function DailyLogTab() {
  const qc = useQueryClient()
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))

  const { data: reportRes, isLoading } = useQuery({
    queryKey: ['daily-report', from, to],
    queryFn: () => importApi.getDailyReport(from, to),
  })

  const rows: DailyDate[] = reportRes?.data ?? []
  const hasData = rows.some(r => r.planned.length > 0 || r.unplanned.length > 0)

  return (
    <div>
      {/* Upload + date filter row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 20 }}>
        <DailyUploadZone onUploaded={() => qc.invalidateQueries({ queryKey: ['daily-report'] })} />
        <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#6B7A99', fontSize: 11, fontWeight: 700 }}>FROM</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputStyle, padding: '6px 10px' }} />
          </label>
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#6B7A99', fontSize: 11, fontWeight: 700 }}>TO</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, padding: '6px 10px' }} />
          </label>
        </div>
      </div>

      {isLoading && (
        <div style={{ ...card, textAlign: 'center', padding: 48, color: '#6B7A99' }}>Loading...</div>
      )}

      {!isLoading && !hasData && (
        <div style={{ ...card, textAlign: 'center', padding: 64 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No data yet</div>
          <div style={{ color: '#6B7A99', fontSize: 13 }}>
            Create TradeSetups in Entry Planner, then upload your Robinhood CSV above after executing.
          </div>
        </div>
      )}

      {rows.filter(r => r.planned.length > 0 || r.unplanned.length > 0).map(row => (
        <DailyDateGroup key={row.date} row={row} />
      ))}
    </div>
  )
}

// ─── Single Date Group ────────────────────────────────────────
function DailyDateGroup({ row }: { row: DailyDate }) {
  const closed  = row.planned.filter(s => s.state === 'Closed')
  const dayPnL  = closed.reduce((sum, s) => sum + (s.pnlDollar ?? 0), 0)
  const unplannedClosed = row.unplanned.filter(u => u.state === 'Closed')
  const totalPnL = dayPnL + unplannedClosed.reduce((sum, u) => sum + (u.pnlDollar ?? 0), 0)

  const [expanded, setExpanded] = useState(true)

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      {/* Date header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: expanded ? 16 : 0 }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace' }}>
            {new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <span style={{ fontSize: 11, color: '#6B7A99' }}>
            {row.planned.length} setup{row.planned.length !== 1 ? 's' : ''}
            {row.unplanned.length > 0 && ` · ${row.unplanned.length} unplanned`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {closed.length > 0 && (
            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: totalPnL >= 0 ? '#00E676' : '#FF4444' }}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </span>
          )}
          <span style={{ color: '#3A4560', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <>
          {/* Planned setups */}
          {row.planned.map(s => <SetupRow key={s.setupId} setup={s} />)}

          {/* Unplanned trades */}
          {row.unplanned.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #1E2A42' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#3A4560', letterSpacing: '0.08em', marginBottom: 8 }}>
                UNPLANNED TRADES
              </div>
              {row.unplanned.map((u, i) => <UnplannedRow key={i} trade={u} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Planned Setup Row ────────────────────────────────────────
function SetupRow({ setup }: { setup: DailySetup }) {
  const stateConfig = {
    Planned: { color: '#6B7A99', bg: '#6B7A9915', label: 'PLANNED' },
    Holding: { color: '#00D4FF', bg: '#00D4FF15', label: 'HOLDING' },
    Closed:  { color: setup.pnlDollar && setup.pnlDollar >= 0 ? '#00E676' : '#FF4444', bg: setup.pnlDollar && setup.pnlDollar >= 0 ? '#00E67615' : '#FF444415', label: 'CLOSED' },
  }[setup.state]

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '130px 90px 1fr 1fr 1fr 1fr',
      alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #0D1526', gap: 8,
    }}>
      {/* Symbol + pattern */}
      <div>
        <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15 }}>{setup.symbol}</span>
        {setup.pattern && (
          <div style={{ fontSize: 10, color: '#3A4560', marginTop: 1 }}>{setup.pattern}</div>
        )}
      </div>

      {/* State badge */}
      <div style={{
        background: stateConfig.bg, color: stateConfig.color,
        padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 800,
        letterSpacing: '0.06em', width: 'fit-content',
      }}>
        {stateConfig.label}
      </div>

      {/* Planned entry */}
      <div>
        <div style={{ fontSize: 10, color: '#3A4560', marginBottom: 2 }}>PLANNED</div>
        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>${setup.plannedEntry.toFixed(2)}</span>
        <span style={{ color: '#3A4560', fontSize: 11 }}> / sl ${setup.stopLoss.toFixed(2)}</span>
      </div>

      {/* Actual entry */}
      <div>
        <div style={{ fontSize: 10, color: '#3A4560', marginBottom: 2 }}>ACTUAL ENTRY</div>
        {setup.actualEntry
          ? <span style={{ fontFamily: 'monospace', fontSize: 13 }}>${setup.actualEntry.toFixed(2)}</span>
          : <span style={{ color: '#3A4560' }}>—</span>
        }
      </div>

      {/* Exit */}
      <div>
        <div style={{ fontSize: 10, color: '#3A4560', marginBottom: 2 }}>EXIT</div>
        {setup.actualExit
          ? <span style={{ fontFamily: 'monospace', fontSize: 13 }}>${setup.actualExit.toFixed(2)}</span>
          : setup.state === 'Holding'
            ? <span style={{ color: '#00D4FF', fontSize: 12 }}>Holding {setup.holdDays}d</span>
            : <span style={{ color: '#3A4560' }}>—</span>
        }
      </div>

      {/* P&L */}
      <div style={{ textAlign: 'right' }}>
        {setup.pnlDollar != null ? (
          <>
            <div style={{
              fontFamily: 'monospace', fontWeight: 800, fontSize: 14,
              color: setup.pnlDollar >= 0 ? '#00E676' : '#FF4444',
            }}>
              {setup.pnlDollar >= 0 ? '+' : ''}${setup.pnlDollar.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: setup.pnlPct! >= 0 ? '#00E676' : '#FF4444' }}>
              {setup.pnlPct! >= 0 ? '+' : ''}{setup.pnlPct!.toFixed(2)}%
            </div>
          </>
        ) : (
          <span style={{ color: '#3A4560' }}>—</span>
        )}
      </div>
    </div>
  )
}

// ─── Unplanned Trade Row ──────────────────────────────────────
function UnplannedRow({ trade }: { trade: DailyUnplanned }) {
  const win = (trade.pnlDollar ?? 0) >= 0

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '130px 90px 1fr 1fr 1fr 1fr',
      alignItems: 'center', padding: '8px 0', gap: 8,
    }}>
      <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15, color: '#FFD600' }}>
        {trade.symbol}
      </div>
      <div style={{
        background: trade.state === 'Holding' ? '#00D4FF15' : win ? '#00E67615' : '#FF444415',
        color: trade.state === 'Holding' ? '#00D4FF' : win ? '#00E676' : '#FF4444',
        padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 800,
        letterSpacing: '0.06em', width: 'fit-content',
      }}>
        {trade.state === 'Holding' ? 'HOLDING' : 'CLOSED'}
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#3A4560', marginBottom: 2 }}>ENTRY</div>
        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>${trade.actualEntry?.toFixed(2) ?? '—'}</span>
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#3A4560', marginBottom: 2 }}>EXIT</div>
        {trade.actualExit
          ? <span style={{ fontFamily: 'monospace', fontSize: 13 }}>${trade.actualExit.toFixed(2)}</span>
          : trade.state === 'Holding'
            ? <span style={{ color: '#00D4FF', fontSize: 12 }}>Holding {trade.holdDays}d</span>
            : <span style={{ color: '#3A4560' }}>—</span>
        }
      </div>
      <div />
      <div style={{ textAlign: 'right' }}>
        {trade.pnlDollar != null ? (
          <>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: win ? '#00E676' : '#FF4444' }}>
              {trade.pnlDollar >= 0 ? '+' : ''}${trade.pnlDollar.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: win ? '#00E676' : '#FF4444' }}>
              {trade.pnlPct! >= 0 ? '+' : ''}{trade.pnlPct!.toFixed(2)}%
            </div>
          </>
        ) : <span style={{ color: '#3A4560' }}>—</span>}
      </div>
    </div>
  )
}

// ─── Daily Upload Zone ────────────────────────────────────────
function DailyUploadZone({ onUploaded }: { onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const mutation = useMutation({
    mutationFn: (file: File) => importApi.uploadDaily(file),
    onSuccess: (res) => {
      const d = res.data
      toast.success(d.message + (d.openLots > 0 ? ` · ${d.openLots} position${d.openLots > 1 ? 's' : ''} still holding.` : ''))
      onUploaded()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Upload failed'),
  })

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'pdf') { toast.error('Only .csv and .pdf supported'); return }
    mutation.mutate(file)
  }, [mutation])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      onClick={() => fileRef.current?.click()}
      style={{
        ...card, flex: 1, textAlign: 'center', cursor: 'pointer', padding: '18px 20px',
        border: `2px dashed ${dragging ? '#00D4FF' : mutation.isPending ? '#00E676' : '#1E2A42'}`,
        background: dragging ? '#00D4FF08' : '#161D2F', transition: 'border-color 0.15s',
      }}
    >
      <input ref={fileRef} type="file" accept=".csv,.pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      {mutation.isPending
        ? <div style={{ color: '#00E676', fontSize: 13 }}>Parsing trades...</div>
        : <>
            <div style={{ fontSize: 22, marginBottom: 4 }}>⬆</div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Upload Robinhood CSV / PDF</div>
            <div style={{ color: '#6B7A99', fontSize: 11 }}>Drop here or click · uploads after each trading day</div>
          </>
      }
    </div>
  )
}

// ─── Challenges Tab ───────────────────────────────────────────
function ChallengesTab() {
  const qc = useQueryClient()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: challengesRes } = useQuery({
    queryKey: ['challenges'],
    queryFn: () => importApi.getChallenges(),
  })

  const { data: detailRes, isLoading: detailLoading } = useQuery({
    queryKey: ['challenge', activeId],
    queryFn: () => importApi.getChallenge(activeId!),
    enabled: activeId != null,
  })

  const challenges: Challenge[] = challengesRes?.data ?? []
  const detail = detailRes?.data

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={() => setShowCreate(true)} style={primaryBtn}>+ New Challenge</button>
      </div>

      {showCreate && (
        <CreateChallengePanel
          onCreated={(id) => { setActiveId(id); setShowCreate(false); qc.invalidateQueries({ queryKey: ['challenges'] }) }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {challenges.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {challenges.map((c: Challenge) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} style={{
              ...challengeChip,
              borderColor: activeId === c.id ? '#00D4FF' : '#1E2A42',
              color: activeId === c.id ? '#00D4FF' : '#6B7A99',
            }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{c.tradeCount} trades · Day {c.daysElapsed}/{c.targetDays}</div>
            </button>
          ))}
        </div>
      )}

      {!activeId && !showCreate && (
        <div style={{ ...card, textAlign: 'center', padding: 64 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Start a challenge</div>
          <div style={{ color: '#6B7A99', fontSize: 13, marginBottom: 20 }}>
            Track a 15-day sprint — upload every closed trade, get behavioral analysis.
          </div>
          <button onClick={() => setShowCreate(true)} style={primaryBtn}>Create Challenge</button>
        </div>
      )}

      {activeId && detailLoading && (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: '#6B7A99' }}>Loading...</div>
      )}

      {activeId && detail && !detailLoading && (
        <ChallengeDetail
          challenge={detail.challenge}
          trades={detail.trades}
          analysis={detail.analysis}
          daysElapsed={detail.daysElapsed}
          daysRemaining={detail.daysRemaining}
          onUploaded={() => qc.invalidateQueries({ queryKey: ['challenge', activeId] })}
          onDelete={() => { setActiveId(null); qc.invalidateQueries({ queryKey: ['challenges'] }) }}
        />
      )}
    </div>
  )
}

// ─── Create Challenge Panel ───────────────────────────────────
function CreateChallengePanel({ onCreated, onCancel }: {
  onCreated: (id: number) => void; onCancel: () => void
}) {
  const [name, setName] = useState('15-Day Minervini Challenge')
  const [capital, setCapital] = useState('2000')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [days, setDays] = useState('15')

  const mutation = useMutation({
    mutationFn: () => importApi.createChallenge({
      name, startDate, startingCapital: parseFloat(capital), targetDays: parseInt(days)
    }),
    onSuccess: (res) => onCreated(res.data.id),
    onError: () => toast.error('Failed to create challenge'),
  })

  return (
    <div style={{ ...card, marginBottom: 20, padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>New Challenge</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <label style={labelStyle}>Name<input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Starting Capital ($)<input type="number" value={capital} onChange={e => setCapital(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Start Date<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Target Days<input type="number" value={days} onChange={e => setDays(e.target.value)} style={inputStyle} /></label>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} style={primaryBtn}>
          {mutation.isPending ? 'Creating...' : 'Create Challenge'}
        </button>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  )
}

// ─── Challenge Detail View ────────────────────────────────────
function ChallengeDetail({ challenge, trades, analysis, daysElapsed, daysRemaining, onUploaded, onDelete }: {
  challenge: any; trades: Trade[]; analysis: Analysis
  daysElapsed: number; daysRemaining: number
  onUploaded: () => void; onDelete: () => void
}) {
  const qc = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: () => importApi.deleteChallenge(challenge.id),
    onSuccess: () => { toast.success('Challenge deleted'); onDelete() },
    onError: () => toast.error('Delete failed'),
  })

  const pnlColor = analysis.totalPnL >= 0 ? '#00E676' : '#FF4444'
  const progressPct = Math.min(100, (daysElapsed / challenge.targetDays) * 100)

  return (
    <div>
      <div style={{ ...card, marginBottom: 16, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{challenge.name}</div>
            <div style={{ color: '#6B7A99', fontSize: 12, marginTop: 2 }}>
              Started {new Date(challenge.startDate).toLocaleDateString()} ·
              ${challenge.startingCapital.toLocaleString()} capital ·
              {daysRemaining > 0 ? ` ${daysRemaining} days remaining` : ' Challenge complete'}
            </div>
          </div>
          <button
            onClick={() => { if (confirm('Delete this challenge and all its trades?')) deleteMutation.mutate() }}
            style={{ background: 'none', border: 'none', color: '#3A4560', cursor: 'pointer', fontSize: 12 }}
          >
            Delete
          </button>
        </div>
        <div style={{ height: 4, background: '#1E2A42', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: '#00D4FF', borderRadius: 2 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#3A4560' }}>
          <span>Day {daysElapsed}</span><span>Day {challenge.targetDays}</span>
        </div>
      </div>

      <UploadZone challengeId={challenge.id} onUploaded={onUploaded} />

      {trades.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 48, color: '#6B7A99', marginTop: 16 }}>
          No trades yet — upload your first Robinhood report above.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 16, marginBottom: 16 }}>
            {[
              { label: 'Win Rate', value: `${analysis.winRate}%`, sub: `${analysis.winners}W / ${analysis.losers}L`, color: analysis.winRate >= 50 ? '#00E676' : '#FF4444' },
              { label: 'Total P&L', value: `${analysis.totalPnL >= 0 ? '+' : ''}$${analysis.totalPnL.toFixed(0)}`, sub: `${analysis.totalPnLPct >= 0 ? '+' : ''}${analysis.totalPnLPct.toFixed(1)}% on capital`, color: pnlColor },
              { label: 'Profit Factor', value: analysis.profitFactor > 0 ? analysis.profitFactor.toFixed(2) : '—', sub: analysis.profitFactor >= 1.5 ? 'Strong edge' : analysis.profitFactor >= 1 ? 'Marginal edge' : 'No edge yet', color: analysis.profitFactor >= 1.5 ? '#00E676' : analysis.profitFactor >= 1 ? '#FFD600' : '#FF4444' },
              { label: 'Avg Hold', value: `${analysis.avgHoldDays}d`, sub: `Winners ${analysis.avgWinHoldDays}d · Losers ${analysis.avgLossHoldDays}d`, color: '#E8EDF5' },
            ].map(s => (
              <div key={s.label} style={card}>
                <div style={{ color: '#6B7A99', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                <div style={{ color: s.color, fontSize: 24, fontWeight: 900, fontFamily: 'monospace', marginBottom: 4 }}>{s.value}</div>
                <div style={{ color: '#3A4560', fontSize: 11 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {analysis.flags.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {analysis.flags.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  background: f.type === 'good' ? '#00E67610' : f.type === 'warning' ? '#FF444410' : '#00D4FF10',
                  border: `1px solid ${f.type === 'good' ? '#00E67630' : f.type === 'warning' ? '#FF444430' : '#00D4FF30'}`,
                  borderRadius: 10, padding: '12px 16px',
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{f.type === 'good' ? '✓' : f.type === 'warning' ? '⚠' : 'ℹ'}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: f.type === 'good' ? '#00E676' : f.type === 'warning' ? '#FF6B6B' : '#00D4FF', marginBottom: 2 }}>{f.title}</div>
                    <div style={{ color: '#6B7A99', fontSize: 12 }}>{f.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#3A4560', letterSpacing: '0.08em', marginBottom: 14 }}>EQUITY CURVE</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={analysis.equityCurve}>
                  <XAxis dataKey="date" tick={{ fill: '#3A4560', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#3A4560', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toLocaleString()}`} width={70} />
                  <Tooltip contentStyle={{ background: '#0D1526', border: '1px solid #1E2A42', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, _: any, props: any) => [`$${Number(v).toFixed(0)}`, props.payload.symbol || 'Equity']}
                    labelStyle={{ color: '#6B7A99' }} />
                  <Line type="monotone" dataKey="equity" stroke="#00D4FF" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#00D4FF' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#3A4560', letterSpacing: '0.08em', marginBottom: 14 }}>HOLD TIME</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={[
                  { name: '1d', count: analysis.holdDistribution.day1 },
                  { name: '2–3d', count: analysis.holdDistribution.day2to3 },
                  { name: '4–7d', count: analysis.holdDistribution.day4to7 },
                  { name: '8–14d', count: analysis.holdDistribution.day8to14 },
                  { name: '14d+', count: analysis.holdDistribution.over14 },
                ]} barSize={24}>
                  <XAxis dataKey="name" tick={{ fill: '#3A4560', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#3A4560', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                  <Tooltip contentStyle={{ background: '#0D1526', border: '1px solid #1E2A42', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#1E2A42' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {['1d','2–3d','4–7d','8–14d','14d+'].map((_, i) => (
                      <Cell key={i} fill={i <= 1 ? '#FF6B6B' : i === 2 ? '#FFD600' : '#00E676'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 10, color: '#3A4560', textAlign: 'center', marginTop: 4 }}>Red = too short · Green = swing range</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#3A4560', letterSpacing: '0.08em', marginBottom: 14 }}>
              TRADES — {trades.length} closed
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Symbol','Entry Date','Exit Date','Entry $','Exit $','Shares','Hold','P&L $','P&L %'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[...trades].reverse().map((t: Trade) => {
                  const win = t.pnLPct > 0
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid #1E2A42' }}>
                      <td style={td}><span style={{ fontFamily: 'monospace', fontWeight: 900 }}>{t.symbol}</span></td>
                      <td style={{ ...td, color: '#6B7A99', fontSize: 12 }}>{new Date(t.entryDate).toLocaleDateString()}</td>
                      <td style={{ ...td, color: '#6B7A99', fontSize: 12 }}>{new Date(t.exitDate).toLocaleDateString()}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>${t.entryPrice.toFixed(2)}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>${t.exitPrice.toFixed(2)}</td>
                      <td style={{ ...td, color: '#6B7A99' }}>{t.shares}</td>
                      <td style={{ ...td, color: '#6B7A99' }}>{t.holdDays}d</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: win ? '#00E676' : '#FF4444' }}>
                        {t.pnLDollar >= 0 ? '+' : ''}${t.pnLDollar.toFixed(2)}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: win ? '#00E676' : '#FF4444' }}>
                        {t.pnLPct >= 0 ? '+' : ''}{t.pnLPct.toFixed(2)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Challenge Upload Zone ────────────────────────────────────
function UploadZone({ challengeId, onUploaded }: { challengeId: number; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const mutation = useMutation({
    mutationFn: (file: File) => importApi.upload(challengeId, file),
    onSuccess: (res) => {
      const d = res.data
      if (d.newCount === 0) toast('No new trades found — already imported or no closed trades yet.')
      else toast.success(`${d.message} ${d.totalTrades} total trades.`)
      onUploaded()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Upload failed'),
  })

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'pdf') { toast.error('Only .csv and .pdf files are supported'); return }
    mutation.mutate(file)
  }, [mutation])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      onClick={() => fileRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? '#00D4FF' : mutation.isPending ? '#00E676' : '#1E2A42'}`,
        borderRadius: 12, padding: '24px 20px', textAlign: 'center',
        cursor: 'pointer', transition: 'border-color 0.15s',
        background: dragging ? '#00D4FF08' : 'transparent',
      }}
    >
      <input ref={fileRef} type="file" accept=".csv,.pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      {mutation.isPending
        ? <div style={{ color: '#00E676', fontSize: 14 }}>Parsing trades...</div>
        : <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⬆</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Drop Robinhood CSV or PDF here</div>
            <div style={{ color: '#6B7A99', fontSize: 12 }}>or click to browse · accepts .csv and .pdf · upload after each trade closes</div>
          </>
      }
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20
}
const th: React.CSSProperties = {
  color: '#3A4560', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  padding: '0 12px 12px 0', textAlign: 'left'
}
const td: React.CSSProperties = { padding: '10px 12px 10px 0', verticalAlign: 'middle' }
const primaryBtn: React.CSSProperties = {
  background: '#00D4FF22', color: '#00D4FF', fontWeight: 700, fontSize: 13,
  padding: '10px 18px', borderRadius: 8, border: '1px solid #00D4FF44', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: '#6B7A99', fontWeight: 600, fontSize: 13,
  padding: '10px 18px', borderRadius: 8, border: '1px solid #1E2A42', cursor: 'pointer',
}
const challengeChip: React.CSSProperties = {
  background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', textAlign: 'left', minWidth: 160,
}
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 12, fontWeight: 600, color: '#6B7A99',
}
const inputStyle: React.CSSProperties = {
  background: '#0D1526', border: '1px solid #1E2A42', borderRadius: 8,
  padding: '9px 12px', color: '#E8EDF5', fontSize: 13, outline: 'none',
}
