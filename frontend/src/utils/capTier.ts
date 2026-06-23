// Midcap universe — matches the seed list in Controllers.cs
const MIDCAP_SYMBOLS = new Set([
  // Technology – Software / Cloud / SaaS
  'DUOL','GTLB','PCTY','SPSC','QLYS','DOCN','FRSH','BRZE','WK',
  'FROG','VERX','ALTR','CWAN','NCNO','JAMF','ZI','S',
  // Technology – Semiconductors
  'CRUS','AMBA','ACLS','CRDO','FORM','POWI','SITM',
  // Communication
  'DV','IAS','ZG',
  // Consumer Discretionary
  'CAVA','BOOT','WING','SFM','CHWY','FIVE','EAT','TXRH','BJ',
  // Consumer Staples
  'CELH','FRPT','VITL',
  // Healthcare
  'INSP','IRTC','TMDX','HIMS','KRYS','PCVX','ACAD','RXST','DNLI','ARWR','RARE',
  // Financials
  'AFRM','SOFI','UPST','RYAN',
  // Industrials
  'KTOS','RKLB','ESAB','GNRC',
  // Energy
  'CIVI','CHRD','SM',
])

export type CapTier = 'MID' | 'LARGE'

export function getCapTier(symbol: string): CapTier {
  return MIDCAP_SYMBOLS.has(symbol.toUpperCase()) ? 'MID' : 'LARGE'
}
