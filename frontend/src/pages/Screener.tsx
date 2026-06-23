import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { stocksApi, watchlistApi, telegramApi } from '../services/api'
import { useStore } from '../store/useStore'
import { getCapTier } from '../utils/capTier'

type SortKey = 'score' | 'canslimScore' | 'minerviniScore' | 'rsRating' | 'epsGrowth' | 'symbol'
type SortDir = 'asc' | 'desc'

function compositeScore(r: any): number {
  const m = (r.minerviniScore / 7) * 40
  const c = (r.canslimScore / 5) * 30
  const rs = (r.rsRating / 99) * 20
  const eps = (Math.min(Math.max(r.epsGrowth ?? 0, 0), 500) / 500) * 10
  return Math.round(m + c + rs + eps)
}

function sectorColor(avgScore: number) {
  if (avgScore >= 65) return '#00E676'
  if (avgScore >= 45) return '#FFD600'
  return '#6B7A99'
}

export default function Screener() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { updateSetup } = useStore()
  const [selectedDate, setSelectedDate] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [scanSecondsLeft, setScanSecondsLeft] = useState<number | null>(null)

  const { data: resultsRes, isLoading } = useQuery({
    queryKey: ['screener', selectedDate],
    queryFn: () => stocksApi.getScreenerResults(selectedDate || undefined),
  })

  const broadcastMutation = useMutation({
    mutationFn: () => telegramApi.broadcast(broadcastMsg),
    onSuccess: () => {
      toast.success('Message sent to all subscribers')
      setShowBroadcast(false)
      setBroadcastMsg('')
    },
    onError: () => toast.error('Failed to send message'),
  })

  const runScanMutation = useMutation({
    mutationFn: () => stocksApi.runScreener(),
    onSuccess: () => {
      toast.success('Scan started — results in ~2 min')
      let secs = 120
      setScanSecondsLeft(secs)
      const interval = setInterval(() => {
        secs -= 1
        setScanSecondsLeft(secs)
        if (secs <= 0) {
          clearInterval(interval)
          setScanSecondsLeft(null)
          qc.invalidateQueries({ queryKey: ['screener'] })
        }
      }, 1000)
    },
    onError: () => toast.error('Failed to start scan'),
  })

  const addToWatchlistMutation = useMutation({
    mutationFn: (symbol: string) => watchlistApi.add({ symbol, notes: 'Added from screener', patternSeen: '' }),
    onSuccess: (_, symbol) => {
      toast.success(`${symbol} added to watchlist`)
      qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: () => toast.error('Failed to add to watchlist'),
  })

  const raw: any[] = resultsRes?.data ?? []

  const lastRunCT = useMemo(() => {
    if (raw.length === 0) return null
    const latest = raw.reduce((max, r) => r.scanDate > max ? r.scanDate : max, raw[0].scanDate)
    const utc = new Date(latest.endsWith('Z') ? latest : latest + 'Z')
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(utc) + ' CT'
  }, [raw])

  const results = useMemo(() => {
    const scored = raw.map(r => ({ ...r, score: compositeScore(r) }))
    return [...scored].sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [raw, sortKey, sortDir])

  // Sector rotation: aggregate picks by sector, sorted by count then avg score
  const sectorStats = useMemo(() => {
    const map = new Map<string, { count: number; scoreSum: number; rsSum: number }>()
    for (const r of results) {
      const key = r.sector || 'Unknown'
      const curr = map.get(key) ?? { count: 0, scoreSum: 0, rsSum: 0 }
      map.set(key, {
        count: curr.count + 1,
        scoreSum: curr.scoreSum + (r.score ?? 0),
        rsSum: curr.rsSum + (r.rsRating ?? 0),
      })
    }
    return Array.from(map.entries())
      .map(([sector, d]) => ({
        sector,
        count: d.count,
        avgScore: Math.round(d.scoreSum / d.count),
        avgRs: Math.round(d.rsSum / d.count),
      }))
      .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
  }, [results])

  const maxCount = Math.max(1, ...sectorStats.map(s => s.count))

  const displayResults = useMemo(
    () => selectedSector ? results.filter(r => r.sector === selectedSector) : results,
    [results, selectedSector]
  )

  function planEntry(r: any) {
    updateSetup({
      symbol: r.symbol,
      canslimScore: r.canslimScore,
      minerviniScore: r.minerviniScore,
      entryPrice: 0,
      stopLoss: 0,
    })
    navigate('/entry')
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Stock Screener</h1>
          {lastRunCT && (
            <p style={{ color: '#3A4560', margin: '0 0 2px', fontSize: 11 }}>
              Last run: <span style={{ color: '#6B7A99' }}>{lastRunCT}</span>
            </p>
          )}
          <p style={{ color: '#6B7A99', margin: 0, fontSize: 13 }}>
            CANSLIM + Minervini daily scan —{' '}
            {selectedSector
              ? <>{displayResults.length} picks in <span style={{ color: '#00D4FF' }}>{selectedSector}</span> · <button onClick={() => setSelectedSector(null)} style={clearBtn}>show all {results.length}</button></>
              : <>{results.length} picks · sorted by composite score</>
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => runScanMutation.mutate()}
            disabled={runScanMutation.isPending || scanSecondsLeft !== null}
            style={{
              background: '#0D1526', border: '1px solid #2A3550', borderRadius: 8,
              padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              color: scanSecondsLeft !== null ? '#FFD600' : '#00E676',
              opacity: runScanMutation.isPending ? 0.6 : 1,
            }}
          >
            {scanSecondsLeft !== null ? `Scanning... ${scanSecondsLeft}s` : '⟳ Run Scan'}
          </button>
          <button
            onClick={() => setShowBroadcast(true)}
            style={{
              background: '#0D1526', border: '1px solid #2A3550', borderRadius: 8,
              padding: '8px 14px', color: '#00D4FF', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            📣 Broadcast
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 8,
              padding: '8px 12px', color: '#E8EDF5', fontSize: 13, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Broadcast Modal */}
      {showBroadcast && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 24, width: 420 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800 }}>Send Telegram Message</h3>
            <textarea
              value={broadcastMsg}
              onChange={e => setBroadcastMsg(e.target.value)}
              placeholder="Type your message... (HTML supported)"
              rows={5}
              style={{
                width: '100%', background: '#0D1526', border: '1px solid #1E2A42', borderRadius: 8,
                padding: 10, color: '#E8EDF5', fontSize: 13, resize: 'vertical', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                onClick={() => { setShowBroadcast(false); setBroadcastMsg('') }}
                style={{ background: 'none', border: '1px solid #1E2A42', borderRadius: 8, padding: '7px 16px', color: '#6B7A99', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={() => broadcastMutation.mutate()}
                disabled={!broadcastMsg.trim() || broadcastMutation.isPending}
                style={{
                  background: '#00D4FF22', border: '1px solid #00D4FF44', borderRadius: 8,
                  padding: '7px 16px', color: '#00D4FF', fontWeight: 700, cursor: 'pointer', fontSize: 13,
                }}
              >
                {broadcastMutation.isPending ? 'Sending...' : 'Send to All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sector Rotation Panel */}
      {!isLoading && sectorStats.length > 0 && (
        <div style={{ ...card, marginBottom: 16, padding: '14px 18px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#3A4560', letterSpacing: '0.08em', marginBottom: 12 }}>
            SECTOR ROTATION — {sectorStats.length} sectors with picks today
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 8 }}>
            {sectorStats.map(s => {
              const isActive = selectedSector === s.sector
              const color = sectorColor(s.avgScore)
              return (
                <button
                  key={s.sector}
                  onClick={() => setSelectedSector(isActive ? null : s.sector)}
                  style={{
                    background: isActive ? '#0D1526' : 'transparent',
                    border: `1px solid ${isActive ? color : '#1E2A42'}`,
                    borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                    textAlign: 'left', position: 'relative', overflow: 'hidden',
                  }}
                >
                  {/* heat bar at bottom proportional to pick count */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: 3,
                    background: `linear-gradient(to right, ${color} ${Math.round(s.count / maxCount * 100)}%, #1E2A42 0%)`,
                    opacity: 0.7,
                  }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#E8EDF5' : '#6B7A99', marginBottom: 5 }}>
                    {s.sector}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace', color }}>
                      {s.count}
                    </span>
                    <span style={{ fontSize: 10, color: '#3A4560' }}>picks</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#3A4560', marginTop: 3 }}>
                    score <span style={{ color, fontWeight: 700 }}>{s.avgScore}</span>
                    {' · '}RS <span style={{ color: s.avgRs >= 70 ? '#00E676' : '#6B7A99', fontWeight: 700 }}>{s.avgRs}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Results Table */}
      <div style={card}>
        {isLoading ? (
          <div style={emptyState}>Loading scan results...</div>
        ) : results.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div>No results for this date.</div>
          </div>
        ) : displayResults.length === 0 ? (
          <div style={emptyState}>No picks in {selectedSector}.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <SortHeader label="Score" sortKey="score" current={sortKey} onSort={handleSort} arrow={arrow('score')}
                  title="Composite: Minervini 40% + CANSLIM 30% + RS 20% + EPS 10%" />
                <SortHeader label="Symbol" sortKey="symbol" current={sortKey} onSort={handleSort} arrow={arrow('symbol')} />
                <SortHeader label="Minervini" sortKey="minerviniScore" current={sortKey} onSort={handleSort} arrow={arrow('minerviniScore')}
                  title="Minervini template score (0-7 conditions met)" />
                <SortHeader label="CANSLIM" sortKey="canslimScore" current={sortKey} onSort={handleSort} arrow={arrow('canslimScore')}
                  title="CANSLIM score (EPS growth, float, RS)" />
                <SortHeader label="RS Rating" sortKey="rsRating" current={sortKey} onSort={handleSort} arrow={arrow('rsRating')}
                  title="Relative strength vs S&P 500 (IBD-style, 1-99)" />
                <SortHeader label="EPS Growth" sortKey="epsGrowth" current={sortKey} onSort={handleSort} arrow={arrow('epsGrowth')}
                  title="Quarter-over-quarter EPS growth %" />
                <th style={th}>Sector</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {displayResults.map((r: any, i: number) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1E2A42' }}>
                  <td style={{ ...td, color: '#3A4560', fontSize: 11, minWidth: 24 }}>{i + 1}</td>
                  <td style={td}>
                    <ScorePill score={r.score} />
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15 }}>{r.symbol}</span>
                      <CapBadge symbol={r.symbol} />
                    </div>
                  </td>
                  <td style={td}>
                    <ScoreBar score={r.minerviniScore} max={7} color="#B388FF" />
                  </td>
                  <td style={td}>
                    <ScoreBar score={r.canslimScore} max={5} color="#00D4FF" />
                  </td>
                  <td style={td}>
                    <span style={{
                      fontFamily: 'monospace', fontWeight: 700,
                      color: r.rsRating >= 80 ? '#00E676' : r.rsRating >= 60 ? '#FFD600' : '#6B7A99',
                    }}>{r.rsRating?.toFixed(0) ?? '—'}</span>
                  </td>
                  <td style={td}>
                    <span style={{ fontFamily: 'monospace', color: r.epsGrowth >= 25 ? '#00E676' : r.epsGrowth < 0 ? '#FF5252' : '#6B7A99' }}>
                      {r.epsGrowth != null ? (r.epsGrowth >= 0 ? '+' : '') + r.epsGrowth.toFixed(0) + '%' : '—'}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    <button
                      onClick={() => setSelectedSector(r.sector === selectedSector ? null : r.sector)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        color: r.sector === selectedSector ? '#00D4FF' : '#6B7A99',
                        fontSize: 12, textDecoration: r.sector === selectedSector ? 'underline' : 'none',
                      }}
                    >
                      {r.sector || '—'}
                    </button>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => addToWatchlistMutation.mutate(r.symbol)}
                        disabled={addToWatchlistMutation.isPending}
                        style={watchlistBtn}>
                        + Watch
                      </button>
                      <button
                        onClick={() => planEntry(r)}
                        style={planBtn}>
                        Plan Entry →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey, current, onSort, arrow, title }: {
  label: string; sortKey: SortKey; current: SortKey
  onSort: (k: SortKey) => void; arrow: string; title?: string
}) {
  return (
    <th
      style={{ ...th, cursor: 'pointer', userSelect: 'none', color: sortKey === current ? '#E8EDF5' : undefined }}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      {label}{arrow}
    </th>
  )
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 70 ? '#00E676' : score >= 50 ? '#FFD600' : score >= 30 ? '#FF9100' : '#6B7A99'
  return (
    <span style={{
      fontFamily: 'monospace', fontWeight: 900, fontSize: 14,
      color, minWidth: 32, display: 'inline-block',
    }}>
      {score}
    </span>
  )
}

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

function ScoreBar({ score, max, color }: { score: number; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ height: 5, width: 56, background: '#1E2A42', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(score / max) * 100}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color }}>{score}/{max}</span>
    </div>
  )
}

const card: React.CSSProperties = { background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }
const emptyState: React.CSSProperties = { textAlign: 'center', padding: 48, color: '#6B7A99' }
const th: React.CSSProperties = { color: '#3A4560', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '0 12px 12px 0', textAlign: 'left' }
const td: React.CSSProperties = { padding: '10px 12px 10px 0', verticalAlign: 'middle' }
const watchlistBtn: React.CSSProperties = {
  background: '#00D4FF22', color: '#00D4FF', fontWeight: 700, fontSize: 11,
  padding: '5px 10px', borderRadius: 6, border: '1px solid #00D4FF44', cursor: 'pointer',
}
const planBtn: React.CSSProperties = {
  background: '#00E67622', color: '#00E676', fontWeight: 700, fontSize: 11,
  padding: '5px 10px', borderRadius: 6, border: '1px solid #00E67644', cursor: 'pointer',
}
const clearBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#6B7A99', fontSize: 13,
  cursor: 'pointer', padding: 0, textDecoration: 'underline',
}
