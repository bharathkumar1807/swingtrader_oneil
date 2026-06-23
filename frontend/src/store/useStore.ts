import { create } from 'zustand'

interface LivePrice {
  price: number
  changePct: number
  updatedAt: Date
}

interface AppState {
  // Live prices from SignalR
  livePrices: Record<string, LivePrice>
  updateLivePrice: (symbol: string, price: number, changePct: number) => void

  // Active trade setup being built
  currentSetup: {
    symbol: string
    canslimScore: number
    minerviniScore: number
    pattern: string
    marketDirection: string
    entryPrice: number
    stopLoss: number
    shares: number
    accountSize: number
    riskPercent: number
    notes: string
  }
  updateSetup: (fields: Partial<AppState['currentSetup']>) => void
  resetSetup: () => void

  // Market direction
  marketDirection: string
  setMarketDirection: (dir: string) => void
}

const defaultSetup = {
  symbol: '',
  canslimScore: 0,
  minerviniScore: 0,
  pattern: '',
  marketDirection: '',
  entryPrice: 0,
  stopLoss: 0,
  shares: 0,
  accountSize: 100000,
  riskPercent: 1,
  notes: '',
}

export const useStore = create<AppState>((set) => ({
  livePrices: {},
  updateLivePrice: (symbol, price, changePct) =>
    set(state => ({
      livePrices: {
        ...state.livePrices,
        [symbol]: { price, changePct, updatedAt: new Date() }
      }
    })),

  currentSetup: defaultSetup,
  updateSetup: (fields) =>
    set(state => ({ currentSetup: { ...state.currentSetup, ...fields } })),
  resetSetup: () => set({ currentSetup: defaultSetup }),

  marketDirection: 'Confirmed Uptrend',
  setMarketDirection: (dir) => set({ marketDirection: dir }),
}))
