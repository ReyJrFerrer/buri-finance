export const institutionPresets = [
  { institution: 'GoTyme', kind: 'Digital bank', currency: 'PHP' },
  { institution: 'MariBank', kind: 'Digital bank', currency: 'PHP' },
  { institution: 'GCash', kind: 'E-wallet', currency: 'PHP' },
  { institution: 'DragonFi', kind: 'Broker (PH stocks)', currency: 'PHP' },
  { institution: 'GoTrade', kind: 'Broker (US stocks)', currency: 'USD' }
] as const

export const baseCurrency = 'PHP'

// Philippine stocks and funds offered when adding a holding; prices for these are entered by
// hand. Stock symbols are PSE tickers. Funds and UITFs have no ticker, so their symbols are
// short codes used only in this app.
export const phSecurityPresets = [
  { symbol: 'BDO', name: 'BDO Unibank' },
  { symbol: 'BPI', name: 'Bank of the Philippine Islands' },
  { symbol: 'MBT', name: 'Metropolitan Bank & Trust' },
  { symbol: 'SECB', name: 'Security Bank' },
  { symbol: 'CBC', name: 'China Banking Corporation' },
  { symbol: 'SM', name: 'SM Investments' },
  { symbol: 'SMPH', name: 'SM Prime Holdings' },
  { symbol: 'AC', name: 'Ayala Corporation' },
  { symbol: 'ALI', name: 'Ayala Land' },
  { symbol: 'JFC', name: 'Jollibee Foods' },
  { symbol: 'URC', name: 'Universal Robina' },
  { symbol: 'MONDE', name: 'Monde Nissin' },
  { symbol: 'PGOLD', name: 'Puregold Price Club' },
  { symbol: 'TEL', name: 'PLDT' },
  { symbol: 'GLO', name: 'Globe Telecom' },
  { symbol: 'CNVRG', name: 'Converge ICT Solutions' },
  { symbol: 'MER', name: 'Manila Electric' },
  { symbol: 'ACEN', name: 'ACEN Corporation' },
  { symbol: 'AEV', name: 'Aboitiz Equity Ventures' },
  { symbol: 'AP', name: 'Aboitiz Power' },
  { symbol: 'ICT', name: 'International Container Terminal Services' },
  { symbol: 'DMC', name: 'DMCI Holdings' },
  { symbol: 'SCC', name: 'Semirara Mining and Power' },
  { symbol: 'GTCAP', name: 'GT Capital Holdings' },
  { symbol: 'LTG', name: 'LT Group' },
  { symbol: 'FMETF', name: 'First Metro Philippine Equity ETF' },
  { symbol: 'PHILEQ', name: 'Philequity Fund' },
  { symbol: 'SLPEF', name: 'Sun Life Prosperity Philippine Equity Fund' },
  { symbol: 'SLPSIF', name: 'Sun Life Prosperity Philippine Stock Index Fund' },
  { symbol: 'ATRAMPEOF', name: 'ATRAM Philippine Equity Opportunity Fund' },
  { symbol: 'FMSLEF', name: 'First Metro Save and Learn Equity Fund' },
  { symbol: 'ALFMGROWTH', name: 'ALFM Growth Fund' },
  { symbol: 'BPIPEIF', name: 'BPI Philippine Equity Index Fund' }
] as const
