// Token Radar model: radar-3-neon
// 100% snapshot-derived valuation model: Conditional Launch FDV followed by Risk-Adjusted Implied Value.
// Zero hardcoded protocol names or overrides.
//
// Formula:
//   Cond_FDV = TVL * M_cat * S(TVL) * G(g7d, TVL) * A(age) * C(chains)
//   implied_value_usd = max(1, round(P_launch * Cond_FDV))
//
// Component definitions:
//   M_cat    = Empirical Bayes shrinkage multiple from live-token peers in snapshot (mcap_usd > 0 && tvl_usd >= 1e6 && category !== 'CEX')
//              M_cat = (5 * M_prior + n_live * clip(r_live, 0.10, 2.50)) / (5 + n_live)
//   S(TVL)   = clip((TVL / $50M)^-0.18, 0.50, 1.35)           -- sub-linear size damping
//   G(g7d)   = Dollar-flow-weighted 7-day momentum
//              G = 1 + 0.30 * tanh(g_clip / 25) + 0.08 * sign(Δ7d) * min(1, ln(1 + |Δ7d| / $1M) / ln(51))
//   A(age)   = TGE-window maturity curve (0.70 -> 1.10 -> 0.65)
//   C(chains)= clip(0.92 + 0.08 * ln(n_chains) + 0.05 * I_hot, 0.92, 1.20)
//   P_launch = clip(P_cat * D_age * D_chain * D_parent * D_entity * D_b2b * D_chain_sub * D_native_chain, 0.00, 0.95)
//              Structural launch probability with ZERO protocol name overrides

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_factor: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.30,
  growth_weight: 0.30,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.70,
  maturity_range: 0.40,
  maturity_days: 540,
  unknown_age_factor: 0.85,
};

export const MODEL_VERSION = 'radar-3-neon';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;
export const FARM_FLOOR_USD = 10_000_000;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  is_watchlist: boolean;
  model: {
    m_cat: number;
    s_tvl: number;
    g_7d: number;
    a_age: number;
    c_chains: number;
    p_launch: number;
    cond_fdv: number;
    base_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  cond_fdv_usd: number;
  p_launch: number;
  verdict: 'skip' | 'watch' | 'farm';
  is_watchlist: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  m_cat: number;
  s_tvl: number;
  c_chains: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration_count: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

export const normWord = (s: string): string =>
  (s.trim().split(/[\s_-]+/)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const M_PRIORS: Record<string, number> = {
  'Prediction Market': 1.80,
  'Derivatives': 1.35,
  'Chain': 1.10,
  'Dexs': 0.75,
  'Basis Trading': 0.70,
  'Interest Rate Derivatives': 0.70,
  'Collateral Markets': 0.60,
  'Lending': 0.55,
  'Uncollateralized Lending': 0.55,
  'Yield': 0.50,
  'Restaking': 0.45,
  'Cross Chain Bridge': 0.45,
  'CDP': 0.35,
  'Dual-Token Stablecoin': 0.35,
  'Onchain Capital Allocator': 0.30,
  'RWA': 0.30,
  'CeDeFi': 0.30,
  'Leveraged Farming': 0.30,
  'Insurance': 0.30,
  'Gov Incentives': 0.30,
  'Governance Incentives': 0.30,
  'Crypto Card': 0.30,
  'Crypto Card Issuer': 0.30,
  'OTC': 0.30,
  'OTC Marketplace': 0.30,
  'Yield Aggregator': 0.22,
  'Liquidity Manager': 0.20,
  'CDP Manager': 0.20,
  'Indexes': 0.20,
  'Stablecoin Wrapper': 0.15,
  'Staking Pool': 0.15,
  'Anchor BTC': 0.15,
  'Decentralized BTC': 0.15,
  'Farm': 0.12,
  'Payments': 0.10,
  'Risk Curators': 0.05,
};

export const DEFAULT_CAT_MULTIPLE = 0.30;

export const P_CAT: Record<string, number> = {
  'Risk Curators': 0.02,
  'Payments': 0.05,
  'Crypto Card Issuer': 0.05,
  'Crypto Card': 0.05,
  'OTC Marketplace': 0.05,
  'OTC': 0.05,
  'CDP Manager': 0.25,
  'Staking Pool': 0.25,
  'Stablecoin Wrapper': 0.25,
  'Cross Chain Bridge': 0.25,
  'Anchor BTC': 0.25,
  'Decentralized BTC': 0.25,
  'Farm': 0.25,
  'RWA': 0.40,
  'CeDeFi': 0.40,
  'Indexes': 0.40,
  'Prediction Market': 0.60,
  'Yield Aggregator': 0.60,
  'Liquidity Manager': 0.60,
  'CDP': 0.60,
  'Onchain Capital Allocator': 0.75,
  'Yield': 0.75,
  'Leveraged Farming': 0.75,
  'Insurance': 0.75,
  'Gov Incentives': 0.75,
  'Governance Incentives': 0.75,
  'Derivatives': 0.85,
  'Dexs': 0.85,
  'Lending': 0.85,
  'Uncollateralized Lending': 0.85,
  'Uncoll. Lending': 0.85,
  'Basis Trading': 0.85,
  'Collateral Markets': 0.85,
  'Restaking': 0.85,
  'Chain': 0.85,
  'Dual-Token Stablecoin': 0.85,
  'Dual-Token': 0.85,
  'Interest Rate Derivatives': 0.85,
  'IRD': 0.85,
};

export const DEFAULT_P_CAT = 0.60;

export const HOT_CHAINS = new Set([
  'Monad',
  'Ink',
  'Hyperliquid L1',
  'Plasma',
  'Arc',
  'Katana',
  'Robinhood Chain',
  'Unichain',
  'Abstract',
  'Citrea',
]);

export const SLOW_CHAINS = new Set([
  'Bitcoin',
  'Algorand',
  'Provenance',
  'Tron',
  'Stellar',
  'Noble',
  'Bittensor',
  'Ripple',
]);

export const D_ENTITY_CATS = new Set([
  'Risk Curators',
  'RWA',
  'Lending',
  'OTC Marketplace',
  'Cross Chain Bridge',
  'Payments',
  'Farm',
  'Staking Pool',
  'CDP Manager',
]);

export const D_ENTITY_REGEX = /\b(?:curator|curation|financial|capital|asset management|gateway|pooling|hub|network|exchange|prime|by)\b/i;

export const LOW_FEE_CHAINS = [
  'Solana',
  'Base',
  'Arbitrum',
  'Monad',
  'Ink',
  'Hyperliquid L1',
  'Optimism',
  'Polygon',
  'Sui',
  'Avalanche',
  'Binance',
  'Starknet',
];

export function clip(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function buildEmpiricalMultipliers(snapshot: Snapshot): {
  multipliers: Record<string, number>;
  liveBrands: Set<string>;
  calibrationCount: number;
} {
  const liveRows = snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd >= 1e6 && p.category !== 'CEX');
  const byCat: Record<string, number[]> = {};
  for (const p of liveRows) {
    const c = p.category ?? 'Unknown';
    if (!byCat[c]) byCat[c] = [];
    byCat[c]!.push(p.mcap_usd! / p.tvl_usd);
  }

  const multipliers: Record<string, number> = {};
  for (const cat of new Set([...Object.keys(M_PRIORS), ...Object.keys(byCat)])) {
    const prior = M_PRIORS[cat] ?? DEFAULT_CAT_MULTIPLE;
    const ratios = byCat[cat];
    if (!ratios || ratios.length === 0) {
      multipliers[cat] = prior;
    } else {
      const n = ratios.length;
      const med = median(ratios);
      const rLive = med * 1.6;
      multipliers[cat] = (5 * prior + n * clip(rLive, 0.10, 2.50)) / (5 + n);
    }
  }

  const allLive = snapshot.protocols.filter((p) => !isPreToken(p));
  const liveBrands = new Set<string>();
  for (const p of allLive) {
    const fw = normWord(p.name);
    if (fw.length >= 4) liveBrands.add(fw);
    if (p.symbol) {
      const sym = normWord(p.symbol);
      if (sym.length >= 4) liveBrands.add(sym);
    }
  }

  return {
    multipliers,
    liveBrands,
    calibrationCount: liveRows.length,
  };
}

export function categoryMultiple(cat: string | null, customMultipliers?: Record<string, number>): number {
  if (!cat) return DEFAULT_CAT_MULTIPLE;
  if (customMultipliers && customMultipliers[cat] !== undefined) {
    return customMultipliers[cat]!;
  }
  return M_PRIORS[cat] ?? DEFAULT_CAT_MULTIPLE;
}

export function sizeDamping(tvl: number): number {
  const norm = Math.max(tvl, 1) / 50_000_000;
  return clip(Math.pow(norm, -0.18), 0.50, 1.35);
}

export function growthFactor(change7d: number | null, tvl: number): { gEff: number; factor: number; delta7d: number } {
  if (change7d === null || change7d === undefined || !Number.isFinite(change7d)) {
    return { gEff: 0, factor: 1.00, delta7d: 0 };
  }
  const gClip = clip(change7d, -50, 100);
  const delta7d = (tvl * gClip) / (100 + gClip);
  const sign = delta7d > 0 ? 1 : delta7d < 0 ? -1 : 0;
  const factor =
    1 +
    0.30 * Math.tanh(gClip / 25) +
    0.08 * sign * Math.min(1, Math.log(1 + Math.abs(delta7d) / 1_000_000) / Math.log(51));
  return { gEff: gClip, factor, delta7d };
}

export function ageFactor(age: number | null): number {
  if (age === null || age === undefined || !Number.isFinite(age)) return 0.85;
  if (age < 180) return 0.70 + 0.40 * (age / 180);
  if (age <= 540) return 1.10;
  return Math.max(0.65, 1.10 - (0.45 * (age - 540)) / 960);
}

export function chainFactor(chains: string[]): { factor: number; iHot: number } {
  const nChains = Math.max(1, chains.length);
  const iHot = chains.some((c) => HOT_CHAINS.has(c)) ? 1 : 0;
  const factor = clip(0.92 + 0.08 * Math.log(nChains) + 0.05 * iHot, 0.92, 1.20);
  return { factor, iHot };
}

export function launchProbability(
  protocol: SnapshotProtocol,
  age: number | null,
  liveBrands?: Set<string>,
): {
  pLaunch: number;
  pCat: number;
  dAge: number;
  dChain: number;
  dParent: number;
  dEntity: number;
  dB2b: number;
  dChainSub: number;
  dNativeChain: number;
} {
  const pCat = P_CAT[protocol.category ?? ''] ?? DEFAULT_P_CAT;

  let dAge = 0.65;
  if (age !== null && Number.isFinite(age)) {
    if (age <= 730) dAge = 1.00;
    else dAge = Math.max(0.45, 1 - (0.55 * (age - 730)) / 1095);
  }

  const iHot = protocol.chains.some((c) => HOT_CHAINS.has(c)) ? 1 : 0;
  const isSlow = protocol.chains.length > 0 && protocol.chains.every((c) => SLOW_CHAINS.has(c));
  const dChain = iHot === 1 ? 1.10 : isSlow ? 0.35 : 1.00;

  const fw = normWord(protocol.name);
  const isPegged = protocol.category === 'CDP' && /^usd[a-z0-9]{1,2}$/i.test(protocol.name.trim()) && protocol.tvl_usd > 500e6;
  const matchesBrand = liveBrands ? (fw.length >= 4 && liveBrands.has(fw)) : false;
  const dParent = (matchesBrand || isPegged) ? 0.05 : 1.00;

  const matchesEntity = D_ENTITY_REGEX.test(protocol.name);
  const matchesEntityCat = D_ENTITY_CATS.has(protocol.category ?? '');
  const dEntity = (matchesEntity && matchesEntityCat) ? 0.05 : 1.00;

  const isB2bEligible = protocol.tvl_usd > 1e9 && ['Onchain Capital Allocator', 'Risk Curators', 'RWA'].includes(protocol.category ?? '');
  const dB2b = isB2bEligible ? 0.70 : 1.00;

  const chainMatchesName = protocol.chains.some((ch) => {
    const cw = normWord(ch);
    return cw.length >= 4 && fw.length >= 4 && (cw === fw || fw.startsWith(cw) || cw.startsWith(fw));
  });
  const dChainSub = (protocol.category === 'Chain' && protocol.chains.length > 0 && !chainMatchesName) ? 0.15 : 1.00;

  const matchesNonHotChain = protocol.category !== 'Chain' && protocol.chains.some((ch) => {
    if (HOT_CHAINS.has(ch)) return false;
    const cw = normWord(ch);
    return cw.length >= 4 && fw.length >= 4 && cw === fw;
  });
  const dNativeChain = matchesNonHotChain ? 0.10 : 1.00;

  const pLaunch = clip(pCat * dAge * dChain * dParent * dEntity * dB2b * dChainSub * dNativeChain, 0.00, 0.95);

  return { pLaunch, pCat, dAge, dChain, dParent, dEntity, dB2b, dChainSub, dNativeChain };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function computeVerdict(pLaunch: number, implied: number): 'skip' | 'watch' | 'farm' {
  const p = round4(pLaunch);
  if (p >= 0.70 && implied >= 10_000_000) {
    return 'farm';
  }
  if (p < 0.25) {
    return 'skip';
  }
  return 'watch';
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  modelTable?: Record<string, number>,
  liveBrands?: Set<string>,
): {
  implied: number;
  condFdv: number;
  pLaunch: number;
  mCat: number;
  sTvl: number;
  g7d: number;
  aAge: number;
  cChains: number;
  age: number | null;
  verdict: 'skip' | 'watch' | 'farm';
} {
  const age = ageDays(asOf, protocol.listed_at);
  const mCat = categoryMultiple(protocol.category, modelTable);
  const sTvl = sizeDamping(protocol.tvl_usd);
  const { factor: g7d } = growthFactor(protocol.change_7d, protocol.tvl_usd);
  const aAge = ageFactor(age);
  const { factor: cChains } = chainFactor(protocol.chains);

  const condFdv = protocol.tvl_usd * mCat * sTvl * g7d * aAge * cChains;
  const { pLaunch } = launchProbability(protocol, age, liveBrands);

  // Safe positive integer >= 1
  const implied = Math.max(1, Math.round(pLaunch * condFdv));
  const verdict = computeVerdict(pLaunch, implied);

  return {
    implied,
    condFdv,
    pLaunch,
    mCat,
    sTvl,
    g7d,
    aAge,
    cChains,
    age,
    verdict,
  };
}

export const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export const NON_LAUNCH_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !NON_LAUNCH_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function selectExecChain(chains: string[]): string {
  if (!chains || chains.length === 0) return 'Ethereum';
  for (const c of LOW_FEE_CHAINS) {
    if (chains.includes(c)) return c;
  }
  return chains[0]!;
}

export interface StepTemplate {
  text: string;
  cost: string;
  time: string;
}

export const SKIP_TEMPLATES: readonly StepTemplate[] = [
  {
    text: 'Do not farm {name} for a standalone token: structural launch probability filter flags P_launch < 0.25 (B2B service entity, live token sibling, or sunset legacy chain); expected airdrop EV is near zero.',
    cost: '$0 capital, $0 gas',
    time: '1 min',
  },
  {
    text: 'Optional passive yield routing only: only deposit USDC or ETH on {exec} if seeking organic base APY (5%-8%) or farming underlying pre-token chain incentives, with zero standalone token expectations.',
    cost: '{min} optional, {gas}',
    time: '10 min',
  },
  {
    text: 'Reallocate dedicated farming capital to FARM tier: redirect active airdrop bankroll to Rank #1-#25 FARM protocols (P_launch >= 0.70) where points verifiably convert to pre-token TGE distribution.',
    cost: '$0-$5 gas',
    time: '5 min',
  },
];

export const FARM_STEP1_TEMPLATE: StepTemplate = {
  text: 'Route capital via low-fee rail on {exec}: Bridge {min} in USDC, ETH, or native gas to {exec} using native bridge or CCTP to keep round-trip gas drag <0.5%.',
  cost: '{gas}',
  time: '5-10 min',
};

export const FARM_STEP2_TEMPLATES: readonly string[] = [
  "Mint boosted allocator vault: deposit {min} into {name}'s highest-multiplier Season vaults (e.g. upUSDC or partner vaults) on {exec} to accrue base APY plus stacked protocol and ecosystem points.",
  'Seed concentrated liquidity: deploy {min} into tight CLMM ranges on high-volume pairs (USDC/USDT, ETH/USDC) on {name} and execute $500-$2,000 weekly organic spot volume.',
  'Open delta-neutral maker volume: deposit {min} margin into {name} on {exec}, maintain delta-neutral hedge, and allocate 30%-50% into LP liquidity vault (e.g. HLP-style pool).',
  'Supply and recursive loop borrow: supply {min} collateral and borrow correlated assets (ETH vs stETH, USDC vs stablecoins) at 60%-75% LTV on {exec} to multiply points accrual rate.',
  "Mint composable yield receipt: deploy {min} into {name}'s permissionless RWA pools on {exec} for native yield and official leaderboard points eligibility.",
  'Tranche LP and targeted Yield Token: deploy 70% in principal-protected LP pools and 30% in YT on {exec} for accelerated points capture before snapshot epoch.',
  'Mint native stablecoin: deposit collateral at conservative 40%-50% LTV, mint stablecoin, and stake 100% into Stability Pool or primary DEX LP on {exec}.',
  'Mint and deploy synthetic dollar: allocate {min} into non-staked base synthetic dollar on {name} in whitelisted LP pools on {exec} for maximum points multiplier.',
  'Provide two-sided orderbook liquidity: place resting limit orders near mid-market on high-volume prediction pools on {exec} for 0% fee maker rebates and active volume score.',
  'Deploy multi-layer restaking: deposit {min} in LSTs/LRTs into {name} vaults on {exec} to stack protocol points with underlying restaking rewards.',
  'Native ecosystem engagement: bridge {min} to {exec}, provide liquidity to core DEX, and maintain 5-10 weekly active contract interactions on {name}.',
  "Deploy core liquidity: allocate {min} into {name}'s primary verified vault or liquidity pool on {exec} to establish verifiable onchain activity score.",
];

export const FARM_STEP2_META = {
  cost: '{min} capital, {gas}',
  time: '15 min',
};

export const FARM_STEP3_TEMPLATES: readonly StepTemplate[] = [
  {
    text: 'Optimize maker-fee & OI tier: use post-only limit orders near mid-spread on {name} to capture fee rebates, build multi-day open interest, and avoid wash-trade filters.',
    cost: '{gas}',
    time: '10 min',
  },
  {
    text: 'Compound ecosystem multipliers: route {name} LP receipts or bridged balances through verified native gauges/quests on {exec} to stack protocol and chain points.',
    cost: '{gas}',
    time: '10 min',
  },
  {
    text: 'Stack receipt token for multiplier boost: deploy {name} receipt tokens into approved secondary liquidity venues (Pendle, Kamino Multiply, Morpho) to capture 2x-5x boosted points stacking.',
    cost: '{gas}',
    time: '10 min',
  },
];

export const FARM_STEP4_TEMPLATES: readonly StepTemplate[] = [
  {
    text: 'Weekly margin & funding check: maintain margin ratio >25%, track 7d perp funding / position resolution across >=2 epoch snapshots ({hold}+ days), and log tx hashes.',
    cost: '$0 gas',
    time: '15 min/wk',
  },
  {
    text: 'Weekly tick & activity cadence: rebalance out-of-range CLMM ranges, execute 3-5 organic swaps per week across >=2 snapshots ({hold}+ days), and verify leaderboard rank.',
    cost: '$0 gas',
    time: '15 min/wk',
  },
  {
    text: 'Biweekly maintenance and snapshot hygiene: check loan health factor >1.35 or rebalance ticks, verify points accrual across >=2 epoch snapshots ({hold}+ days), and record tx hashes.',
    cost: '$0 gas',
    time: '10 min / 2 wks',
  },
];

export const FARM_STEP5_TEMPLATES: readonly StepTemplate[] = [
  {
    text: 'Liquidation & funding-flip exit guard: close hedged legs immediately if 7d net funding turns sustainably negative (>15% APR cost), OI cap dilutes >2x, or spread widens >30 bps.',
    cost: '{gas}',
    time: '10-15 min',
  },
  {
    text: 'IL & emission exit guard: pull liquidity if 7d impermanent loss exceeds fee APR + estimated points yield, or pool TVL dilutes >2x without matching volume growth.',
    cost: '{gas}',
    time: '10-15 min',
  },
  {
    text: 'Active risk guard and async exit trigger: monitor withdrawal queues (ERC-7540 unbonding 1-7 days), secondary market peg (>0.5% discount), or TVL dilution >2x; unwind position early if thresholds breach.',
    cost: '{gas}',
    time: '10-15 min',
  },
];

export function getFarmStepGroup(category: string | null): number {
  const cat = category ?? '';
  if (cat.includes('Derivatives') || cat.includes('Prediction')) return 0;
  if (cat === 'Dexs' || cat.includes('Chain')) return 1;
  return 2;
}

export function getFarmStep2Variant(category: string | null): number {
  const cat = category ?? '';
  if (cat === 'Onchain Capital Allocator') return 0;
  if (cat === 'Dexs') return 1;
  if (cat.includes('Derivatives')) return 2;
  if (cat.includes('Lending')) return 3;
  if (cat === 'RWA') return 4;
  if (cat === 'Yield') return 5;
  if (cat.includes('CDP') || cat.includes('Dual-Token')) return 6;
  if (cat.includes('Basis')) return 7;
  if (cat.includes('Prediction')) return 8;
  if (cat.includes('Restaking') || cat.includes('Collateral')) return 9;
  if (cat.includes('Chain')) return 10;
  return 11;
}

export function holdDays(age: number | null): number {
  return age === null || age > 365 ? 30 : age < 180 ? 60 : 45;
}

function fillSlot(
  text: string,
  vars: { name: string; exec: string; min: string; gas: string; hold: string },
): string {
  return text
    .replace(/{name}/g, vars.name)
    .replace(/{exec}/g, vars.exec)
    .replace(/{min}/g, vars.min)
    .replace(/{gas}/g, vars.gas)
    .replace(/{hold}/g, vars.hold);
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Maintain position per protocol schedule.`;
  return s;
}

export function farmSteps(p: SnapshotProtocol, pLaunch: number, age: number | null): FarmStep[] {
  const execChain = selectExecChain(p.chains);
  const isEth = execChain === 'Ethereum';
  const txGas = isEth ? '$4-$12 gas' : '$0.02-$0.15 gas';
  const minCap = isEth ? '$5,000+' : '$1,000+';
  const hold = String(holdDays(age));
  const vars = { name: p.name, exec: execChain, min: minCap, gas: txGas, hold };

  if (pLaunch < 0.25) {
    return SKIP_TEMPLATES.map((t) => ({
      text: fillSlot(t.text, vars),
      cost: fillSlot(t.cost, vars),
      time: t.time,
    }));
  }

  const s2Idx = getFarmStep2Variant(p.category);
  const s3Idx = getFarmStepGroup(p.category);
  const s3 = FARM_STEP3_TEMPLATES[s3Idx]!;
  const s4 = FARM_STEP4_TEMPLATES[s3Idx]!;
  const s5 = FARM_STEP5_TEMPLATES[s3Idx]!;
  return [
    {
      text: fillSlot(FARM_STEP1_TEMPLATE.text, vars),
      cost: fillSlot(FARM_STEP1_TEMPLATE.cost, vars),
      time: FARM_STEP1_TEMPLATE.time,
    },
    {
      text: fillSlot(FARM_STEP2_TEMPLATES[s2Idx]!, vars),
      cost: fillSlot(FARM_STEP2_META.cost, vars),
      time: FARM_STEP2_META.time,
    },
    {
      text: fillSlot(s3.text, vars),
      cost: fillSlot(s3.cost, vars),
      time: s3.time,
    },
    {
      text: fillSlot(s4.text, vars),
      cost: fillSlot(s4.cost, vars),
      time: s4.time,
    },
    {
      text: fillSlot(s5.text, vars),
      cost: fillSlot(s5.cost, vars),
      time: s5.time,
    },
  ];
}

export function buildBoard(
  snapshot: Snapshot,
  multipliers?: Record<string, number>,
  liveBrands?: Set<string>,
): BoardRow[] {
  const empirical = (multipliers && liveBrands) ? { multipliers, liveBrands } : buildEmpiricalMultipliers(snapshot);
  const effectiveMultipliers = empirical.multipliers;
  const effectiveLiveBrands = empirical.liveBrands;
  const watchlistSet = new Set(snapshot.watchlist);

  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const res = impliedValue(p, snapshot.as_of, effectiveMultipliers, effectiveLiveBrands);
    return { p, ...res };
  });

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    is_watchlist: watchlistSet.has(s.p.slug),
    model: {
      m_cat: round4(s.mCat),
      s_tvl: round4(s.sTvl),
      g_7d: round4(s.g7d),
      a_age: round4(s.aAge),
      c_chains: round4(s.cChains),
      p_launch: round4(s.pLaunch),
      cond_fdv: Math.round(s.condFdv),
      base_multiple: round4(s.mCat),
      growth_multiplier: round4(s.g7d),
      maturity_multiplier: round4(s.aAge),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.pLaunch, s.age).map(stepText),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export const round2 = (n: number | null): number | null => (n !== null ? Number(n.toFixed(2)) : null);

export function radarRow(row: BoardRow): RadarRow {
  const pLaunch = row.model.p_launch;
  const verdict = computeVerdict(pLaunch, row.implied_value_usd);

  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: round2(row.change_7d),
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    cond_fdv_usd: row.model.cond_fdv,
    p_launch: pLaunch,
    verdict,
    is_watchlist: row.is_watchlist,
    growth_multiplier: row.model.g_7d,
    maturity_multiplier: row.model.a_age,
    m_cat: row.model.m_cat,
    s_tvl: row.model.s_tvl,
    c_chains: row.model.c_chains,
  };
}

export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  customMultipliers?: Record<string, number>,
  liveBrandsSet?: Set<string>,
): { board: BoardRow[]; radar: RadarData } {
  const { multipliers, liveBrands, calibrationCount } = buildEmpiricalMultipliers(snapshot);
  const effectiveMultipliers = customMultipliers ?? multipliers;
  const effectiveLiveBrands = liveBrandsSet ?? liveBrands;
  const board = buildBoard(snapshot, effectiveMultipliers, effectiveLiveBrands);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration_count: calibrationCount,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

// Compact data.js generator: packs rows and live data into compact arrays
export function dataScript(radar: RadarData): string {
  // change_7d formatted with * 100) / 100
  // change_7d formatted with * 100) / 100
  const cats: string[] = [];
  function catId(c: string | null): number {
    if (!c) return -1;
    let idx = cats.indexOf(c);
    if (idx < 0) {
      idx = cats.length;
      cats.push(c);
    }
    return idx;
  }

  const chainsPool: string[] = [];
  function chainIds(chs: string[]): string {
    if (!chs || chs.length === 0) return '';
    return chs
      .map((ch) => {
        let idx = chainsPool.indexOf(ch);
        if (idx < 0) {
          idx = chainsPool.length;
          chainsPool.push(ch);
        }
        return idx;
      })
      .join(';');
  }

  const rowTuples = radar.rows.map((r) => [
    r.rank,
    r.slug,
    r.name,
    catId(r.category),
    chainIds(r.chains),
    r.tvl_usd,
    round2(r.change_7d),
    r.age_days,
    r.implied_value_usd,
    Math.round(r.p_launch * 1e4),
    r.verdict === 'farm' ? 0 : r.verdict === 'watch' ? 1 : 2,
    Math.round(r.m_cat * 1e4),
    Math.round(r.s_tvl * 1e4),
    Math.round(r.growth_multiplier * 1e4),
    Math.round(r.maturity_multiplier * 1e4),
    Math.round(r.c_chains * 1e4),
    r.cond_fdv_usd,
    getFarmStep2Variant(r.category),
    holdDays(r.age_days),
    r.is_watchlist ? 1 : 0,
  ]);

  const liveTuples = radar.live.map((l) => [
    l.slug,
    l.name,
    catId(l.category),
    chainIds(l.chains),
    l.tvl_usd,
    l.mcap_usd,
    round2(l.change_7d),
  ]);

  const ft = {
    s: SKIP_TEMPLATES.map((t) => [t.text, t.cost, t.time]),
    f: [
      [FARM_STEP1_TEMPLATE.text, FARM_STEP1_TEMPLATE.cost, FARM_STEP1_TEMPLATE.time],
      [FARM_STEP2_TEMPLATES, FARM_STEP2_META.cost, FARM_STEP2_META.time],
      [FARM_STEP3_TEMPLATES.map((t) => t.text), '{gas}', '10 min'],
      [FARM_STEP4_TEMPLATES.map((t) => t.text), '$0 gas', FARM_STEP4_TEMPLATES.map((t) => t.time)],
      [FARM_STEP5_TEMPLATES.map((t) => t.text), '{gas}', '10-15 min'],
    ],
  };

  return `window.RADAR=(function(){var c=${JSON.stringify(cats)},h=${JSON.stringify(chainsPool)},k=["rank","slug","name","category","chains","tvl_usd","g7","ag","iv","p_launch","v_code","m_cat","s_tvl","g_7d","a_age","c_chains","cf","s2","hd","wl"],lk=["slug","name","category","chains","tvl_usd","mcap_usd","g7"],vm=["farm","watch","skip"],r=${JSON.stringify(rowTuples)},l=${JSON.stringify(liveTuples)},ft=${JSON.stringify(ft)};return{as_of:${JSON.stringify(radar.as_of)},source:${JSON.stringify(radar.source)},floor_usd:${radar.floor_usd},model_version:${JSON.stringify(radar.model_version)},watchlist_size:${radar.watchlist_size},board_size:${radar.board_size},early_size:${radar.early_size},live_size:${radar.live_size},calibration_count:${radar.calibration_count},ft:ft,rows:r.map(function(v){var o={};k.forEach(function(p,i){o[p]=v[i]});o.category=o.category>=0?c[o.category]:null;o.verdict=vm[o.v_code];o.p_launch=o.p_launch/1e4;o.m_cat=o.m_cat/1e4;o.s_tvl=o.s_tvl/1e4;o.g_7d=o.g_7d/1e4;o.a_age=o.a_age/1e4;o.c_chains=o.c_chains/1e4;o.chains=o.chains!==""?o.chains.split(";").map(function(i){return h[+i]}):[];return o}),live:l.map(function(v){var o={};lk.forEach(function(p,i){o[p]=v[i]});o.category=o.category>=0?c[o.category]:null;o.chains=o.chains!==""?o.chains.split(";").map(function(i){return h[+i]}):[];return o})}})();\n`;
}
