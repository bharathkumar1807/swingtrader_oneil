import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { journalApi } from '../services/api'

const GRADES = ['A', 'B', 'C']
const gradeColor = (g: string) => g === 'A' ? '#00E676' : g === 'B' ? '#FFD600' : '#FF4444'

export default function Journal() {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ grade: '', notes: '' })

  const { data: journalRes, isLoading } = useQuery({ queryKey: ['journal'], queryFn: () => journalApi.getAll() })
  const { data: statsRes } = useQuery({ queryKey: ['stats'], queryFn: () => journalApi.getStats() })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: any }) => journalApi.update(id, dto),
    onSuccess: () => {
      toast.success('Saved ✓')
      setEditingId(null)
      qc.invalidateQueries({ queryKey: ['journal'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
    onError: () => toast.error('Save failed'),
  })

  function startEdit(entry: any) {
    setEditingId(entry.id)
    setEditForm({ grade: entry.grade || 'B', notes: entry.notes || '' })
  }

  const trades: any[] = journalRes?.data ?? []
  const s = statsRes?.data

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24, letterSpacing: '-0.02em' }}>Trade Journal</h1>

      {/* Performance Summary */}
      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Trades', value: s.totalTrades, color: '#E8EDF5' },
            { label: 'Win Rate', value: `${s.winRate?.toFixed(1)}%`, color: '#00E676' },
            { label: 'Avg Win', value: `+${s.avgGain?.toFixed(1)}%`, color: '#00E676' },
            { label: 'Avg Loss', value: `${s.avgLoss?.toFixed(1)}%`, color: '#FF4444' },
            { label: 'Profit Factor', value: s.profitFactor?.toFixed(2), color: s.profitFactor >= 1.5 ? '#00E676' : '#FFD600' },
            { label: 'Total P&L', value: `${s.totalPnL >= 0 ? '+' : ''}$${s.totalPnL?.toFixed(0)}`, color: s.totalPnL >= 0 ? '#00E676' : '#FF4444' },
          ].map(stat => (
            <div key={stat.label} style={card}>
              <div style={dimLabel}>{stat.label}</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 20, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Trade Table */}
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Symbol', 'Pattern', 'Entry', 'Exit', 'Shares', 'P&L $', 'P&L %', 'Days', 'Reason', 'Grade', 'Exit Date', ''].map(h => (
                  <th key={h} style={{ ...th, textAlign: h === '' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#3A4560' }}>Loading...</td></tr>
              ) : trades.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#3A4560' }}>
                  No closed trades yet — close a position to see it here
                </td></tr>
              ) : trades.map((t: any) => {
                const isEditing = editingId === t.id
                const pnlColor = t.realizedPnL >= 0 ? '#00E676' : '#FF4444'
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #1E2A42' }}>
                    <td style={td}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15 }}>{t.symbol}</span>
                    </td>
                    <td style={td}>
                      <span style={{ color: '#6B7A99', fontSize: 12 }}>{t.pattern || '—'}</span>
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>${t.entryPrice?.toFixed(2)}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>${t.exitPrice?.toFixed(2)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', color: '#6B7A99' }}>{t.shares}</td>
                    <td style={{ ...td, fontFamily: 'monospace', color: pnlColor, fontWeight: 700 }}>
                      {t.realizedPnL >= 0 ? '+' : ''}${t.realizedPnL?.toFixed(0)}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', color: pnlColor, fontWeight: 700 }}>
                      {t.realizedPnLPct >= 0 ? '+' : ''}{t.realizedPnLPct?.toFixed(2)}%
                    </td>
                    <td style={{ ...td, color: '#6B7A99' }}>{t.daysHeld}d</td>
                    <td style={td}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: '#1E2A42', color: '#6B7A99',
                      }}>{t.exitReason || '—'}</span>
                    </td>
                    <td style={td}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {GRADES.map(g => (
                            <button key={g} onClick={() => setEditForm(f => ({ ...f, grade: g }))}
                              style={{
                                width: 28, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 800,
                                border: '1px solid', cursor: 'pointer',
                                borderColor: editForm.grade === g ? gradeColor(g) : '#1E2A42',
                                background: editForm.grade === g ? gradeColor(g) + '22' : 'transparent',
                                color: editForm.grade === g ? gradeColor(g) : '#3A4560',
                              }}>{g}</button>
                          ))}
                        </div>
                      ) : (
                        <span style={{
                          fontWeight: 900, fontSize: 14, color: gradeColor(t.grade || ''),
                          background: gradeColor(t.grade || '') + '22',
                          padding: '2px 8px', borderRadius: 4,
                        }}>{t.grade || '—'}</span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#6B7A99', fontSize: 11 }}>
                      {t.exitDate ? new Date(t.exitDate).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            value={editForm.notes}
                            onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                            placeholder="Notes..."
                            style={{
                              background: '#111827', border: '1px solid #1E2A42', borderRadius: 4,
                              padding: '4px 8px', color: '#E8EDF5', fontSize: 12, width: 160, outline: 'none',
                            }}
                          />
                          <button
                            onClick={() => updateMutation.mutate({ id: t.id, dto: { grade: editForm.grade, notes: editForm.notes } })}
                            style={{ background: '#00D4FF', color: '#000', fontWeight: 700, fontSize: 11, padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
                            Save
                          </button>
                          <button onClick={() => setEditingId(null)}
                            style={{ background: 'transparent', color: '#6B7A99', fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid #1E2A42', cursor: 'pointer' }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {t.notes && (
                            <span style={{ color: '#3A4560', fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.notes}>
                              {t.notes}
                            </span>
                          )}
                          <button onClick={() => startEdit(t)}
                            style={{ background: 'transparent', color: '#3A4560', fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #1E2A42', cursor: 'pointer' }}>
                            Edit
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const card: React.CSSProperties = { background: '#161D2F', border: '1px solid #1E2A42', borderRadius: 12, padding: 20 }
const dimLabel: React.CSSProperties = { color: '#6B7A99', fontSize: 11, fontWeight: 600, marginBottom: 6 }
const th: React.CSSProperties = { color: '#3A4560', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '0 12px 12px 0', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 12px 10px 0', verticalAlign: 'middle' }
