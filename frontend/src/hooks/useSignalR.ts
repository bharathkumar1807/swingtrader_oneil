import { useEffect, useRef, useCallback } from 'react'
import * as signalR from '@microsoft/signalr'
import { useStore } from '../store/useStore'

export function useSignalR(symbols: string[]) {
  const connectionRef = useRef<signalR.HubConnection | null>(null)
  const updatePrice = useStore(s => s.updateLivePrice)

  const connect = useCallback(async () => {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/price')
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    // Listen for price updates from backend
    connection.on('PriceUpdate', (update: {
      symbol: string
      price: number
      changePct: number
      volume: number
      timestamp: string
    }) => {
      updatePrice(update.symbol, update.price, update.changePct)
    })

    connection.onreconnected(() => {
      console.log('SignalR reconnected — resubscribing...')
      if (symbols.length > 0) {
        connection.invoke('SubscribeToSymbols', symbols)
      }
    })

    await connection.start()
    console.log('SignalR connected ✓')

    if (symbols.length > 0) {
      await connection.invoke('SubscribeToSymbols', symbols)
    }

    connectionRef.current = connection
  }, [symbols, updatePrice])

  useEffect(() => {
    connect()
    return () => {
      connectionRef.current?.stop()
    }
  }, [connect])

  // Subscribe to new symbols dynamically
  const subscribe = useCallback(async (newSymbols: string[]) => {
    if (connectionRef.current?.state === signalR.HubConnectionState.Connected) {
      await connectionRef.current.invoke('SubscribeToSymbols', newSymbols)
    }
  }, [])

  return { subscribe }
}
