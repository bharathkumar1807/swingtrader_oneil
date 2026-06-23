import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' }
})

// ─── Stocks / Market Data ─────────────────────────────────────
export const stocksApi = {
  getSnapshot: (symbol: string) => api.get(`/stocks/snapshot/${symbol}`),
  getBars: (symbol: string, timeframe = '1Day', limit = 200) =>
    api.get(`/stocks/bars/${symbol}`, { params: { timeframe, limit } }),
  getMovingAverages: (symbol: string) => api.get(`/stocks/moving-averages/${symbol}`),
  checkMinervini: (symbol: string) => api.get(`/stocks/minervini/${symbol}`),
  getScreenerResults: (date?: string) => api.get('/stocks/screener', { params: { date } }),
  runScreener: () => api.post('/stocks/screener/run'),
  getAutoSuggest: (symbol: string) => api.get(`/stocks/autosuggest/${symbol}`),
  addStock: (stock: any) => api.post('/stocks', stock),
}

// ─── Watchlist ────────────────────────────────────────────────
export const watchlistApi = {
  getAll: () => api.get('/watchlist'),
  add: (item: any) => api.post('/watchlist', item),
  remove: (id: number) => api.delete(`/watchlist/${id}`),
}

// ─── Trades ───────────────────────────────────────────────────
export const tradesApi = {
  calculate: (req: {
    accountSize: number
    riskPercent: number
    entryPrice: number
    stopLoss: number
  }) => api.post('/trades/calculate', req),

  createSetup: (dto: any) => api.post('/trades/setup', dto),
  getSetups: () => api.get('/trades/setups'),
  activateTrade: (setupId: number) => api.post(`/trades/activate/${setupId}`),
  closeTrade: (dto: any) => api.post('/trades/close', dto),
}

// ─── Positions ────────────────────────────────────────────────
export const positionsApi = {
  getOpen: () => api.get('/positions'),
}

// ─── Journal ──────────────────────────────────────────────────
export const journalApi = {
  getAll: () => api.get('/journal'),
  getStats: () => api.get('/journal/stats'),
  update: (id: number, dto: any) => api.put(`/journal/${id}`, dto),
}

// ─── Market ───────────────────────────────────────────────────
export const marketApi = {
  getCurrent: () => api.get('/market/current'),
  log: (dto: any) => api.post('/market', dto),
}

// ─── Orders (Paper Trading) ───────────────────────────────────
export const ordersApi = {
  getOpen: () => api.get('/orders'),
  getOrder: (id: string) => api.get(`/orders/${id}`),
  cancel: (id: string) => api.delete(`/orders/${id}`),
  syncPosition: (positionId: number) => api.post(`/orders/sync/${positionId}`),
  getAlpacaPositions: () => api.get('/orders/account/positions'),
  getAccount: () => api.get('/orders/account'),
}

// ─── Backtest ─────────────────────────────────────────────────
export const backtestApi = {
  run: (req: {
    symbol: string
    startDate: string
    endDate: string
    accountSize: number
    riskPercent: number
  }) => api.post('/backtest/run', req),
}

// ─── Trade Report / Import ────────────────────────────────────
export const importApi = {
  createChallenge: (dto: {
    name: string; startDate: string; startingCapital: number; targetDays: number
  }) => api.post('/import/challenge', dto),

  getChallenges: () => api.get('/import/challenges'),

  getChallenge: (id: number) => api.get(`/import/challenge/${id}`),

  upload: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/import/challenge/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  deleteChallenge: (id: number) => api.delete(`/import/challenge/${id}`),

  // Daily log — standalone upload, no challenge required
  uploadDaily: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/import/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  getDailyReport: (from?: string, to?: string) =>
    api.get('/import/daily-report', { params: { from, to } }),
}

// ─── Telegram ─────────────────────────────────────────────────
export const telegramApi = {
  broadcast: (message: string) => api.post('/telegram/broadcast', { message }),
}

export default api
