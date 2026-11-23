// lib/farm.ts: Costed Farm ROI engine, nearest live comps, and farm step templates
// Ported 1:1 from verify-r41.py (Stage C). Fully deterministic.

import type { SnapshotProtocol } from './model.ts';
import { macroGroup } from './model.ts';
import { roundJs } from './stats.ts';

// ---------------- §1 ROI Engine ----------------

// chain -> [gas_per_tx_usd, bridge_usd]. Default for unlisted chains: L2/fast-EVM.
export const GAS_TABLE: Record<string, [number, number]> = {
  'Solana': [0.005, 0.50],
  'Sui': [0.005, 0.50],
  'Aptos': [0.005, 0.50],
  'Stellar': [0.005, 0.50],
  'Base': [0.08, 1.50],
  'Arbitrum': [0.08, 1.50],
  'Optimism': [0.08, 1.50],
  'Polygon': [0.08, 1.50],
  'Monad': [0.08, 1.50],
  'Ink': [0.08, 1.50],
  'Hyperliquid L1': [0.08, 1.50],
  'Plasma': [0.08, 1.50],
  'Sonic': [0.08, 1.50],
  'Katana': [0.08, 1.50],
  'Unichain': [0.08, 1.50],
  'Abstract': [0.08, 1.50],
  'Binance': [0.08, 1.50],
  'Avalanche': [0.08, 1.50],
  'Starknet': [0.25, 2.50],
  'Scroll': [0.25, 2.50],
  'Linea': [0.25, 2.50],
  'zkSync': [0.25, 2.50],
  'zkSync Era': [0.25, 2.50],
  'Ethereum': [7.50, 9.00],
  'Bitcoin': [2.50, 6.00],
  'Core': [2.50, 6.00],
  'BSquared': [2.50, 6.00],
  'Bitlayer': [2.50, 6.00],
  'Citrea': [2.50, 6.00],
  'Hemi': [2.50, 6.00],
};

export const GAS_DEFAULT: [number, number] = [0.08, 1.50];

/**
 * (txCount, slippageBps, holdDays, setupMin, weeklyMin, alpha_circ). J4.
 * alpha_circ = circulating-MCap airdrop share (assumption, labeled in UI).
 */
export function blueprint(
  cat: string | null,
): [number, number, number, number, number, number] {
  if (
    cat === 'Derivatives' ||
    cat === 'Prediction Market' ||
    cat === 'Interest Rate Derivatives'
  ) {
    return [18, 15, 52.5, 25, 25, 0.25];
  }
  if (cat === 'Dexs' || cat === 'Chain') {
    return [10, 20, 52.5, 20, 15, 0.22];
  }
  return [6, 10, 45.0, 15, 5, 0.20];
}

export interface RoiResult {
  exec_chain: string;
  total_min: number;
  y_airdrop_ann: number;
  gross_hold: number;
  c_hard: number;
  k_min: number;
  net_cash_ev_10k: number;
  alpha_circ: number;
  hold_days: number;
  gas_per_tx: number;
  bridge_usd: number;
  tx_count: number;
}

export function roi(protocol: SnapshotProtocol, implied: number): RoiResult {
  const [tx, bps, hold, setupMin, wkmin, alphaCirc] = blueprint(protocol.category);

  let best: { cost: number; exec_chain: string; gas: number; bridge: number } | null = null;
  for (const ch of protocol.chains ?? []) {
    const [g, b] = GAS_TABLE[ch] ?? GAS_DEFAULT;
    const cost = b + tx * g;
    if (best === null || cost < best.cost) {
      best = { cost, exec_chain: ch, gas: g, bridge: b };
    }
  }

  const execChain = best !== null ? best.exec_chain : '(none)';
  const gas = best !== null ? best.gas : GAS_DEFAULT[0];
  const bridge = best !== null ? best.bridge : GAS_DEFAULT[1];

  const cHard = bridge + tx * gas;
  const totalMin = roundJs(setupMin + wkmin * (hold / 7.0));
  const poolRatio = (implied * alphaCirc) / protocol.tvl_usd;
  const grossHold = poolRatio * (hold / 180.0);
  const yAirdropAnn = Math.min(0.50, poolRatio * (365.0 / 180.0));
  const v = bps / 10000.0;
  const netPerDollar = grossHold - v;
  const kFee = cHard / 0.005;
  const kBe = cHard / Math.max(0.002, netPerDollar);
  const floor = execChain === 'Ethereum' ? 2500 : 500;
  const kMin = Math.max(floor, roundJs(Math.max(kFee, kBe) / 250.0) * 250);
  const netCashEv10k = 10000.0 * netPerDollar - cHard;

  return {
    exec_chain: execChain,
    total_min: totalMin,
    y_airdrop_ann: yAirdropAnn,
    gross_hold: grossHold,
    c_hard: cHard,
    k_min: kMin,
    net_cash_ev_10k: netCashEv10k,
    alpha_circ: alphaCirc,
    hold_days: hold,
    gas_per_tx: gas,
    bridge_usd: bridge,
    tx_count: tx,
  };
}

export function stepCosts(r: RoiResult): [string, string, string, string, string] {
  const total_c = roundJs(r.c_hard * 100);
  const s1 = roundJs((r.bridge_usd + r.gas_per_tx) * 100);
  const s2 = roundJs(2 * r.gas_per_tx * 100);
  let s3 = roundJs((r.tx_count - 5) * r.gas_per_tx * 100);
  const s5 = roundJs(2 * r.gas_per_tx * 100);
  s3 += total_c - (s1 + s2 + s3 + s5);
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  return [fmt(s1), fmt(s2), fmt(s3), '$0.00', fmt(s5)];
}

// ---------------- §2 Nearest Live Comps (k=3) ----------------

export interface LiveComp {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  distance: number;
}

export interface CompPoolEntry {
  slug: string;
  name: string;
  category: string | null;
  macro_group: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
}

function round4(x: number): number {
  return roundJs(x * 1e4) / 1e4;
}

export function nearestComps(
  protocol: {
    slug: string;
    category: string | null;
    macro_group?: string;
    chains: string[];
    tvl_usd: number;
  },
  pool: CompPoolEntry[],
): LiveComp[] {
  const g_i = protocol.macro_group ?? macroGroup(protocol.category);
  const setA = new Set(protocol.chains ?? []);
  const lnTvl_i = Math.log(Math.max(1, protocol.tvl_usd));

  const scored: { entry: CompPoolEntry; d: number }[] = [];

  for (const entry of pool) {
    if (entry.slug === protocol.slug) continue;

    const termCat = protocol.category !== entry.category ? 2.0 : 0.0;
    const termMacro = g_i !== entry.macro_group ? 0.5 : 0.0;
    const lnTvl_j = Math.log(Math.max(1, entry.tvl_usd));
    const termTvl = Math.abs(lnTvl_i - lnTvl_j);

    const setB = new Set(entry.chains ?? []);
    let jaccard: number;
    if (setA.size === 0 && setB.size === 0) {
      jaccard = 1.0;
    } else if (setA.size === 0 || setB.size === 0) {
      jaccard = 0.0;
    } else {
      let inter = 0;
      for (const ch of setA) {
        if (setB.has(ch)) inter++;
      }
      const union = setA.size + setB.size - inter;
      jaccard = union > 0 ? inter / union : 1.0;
    }
    const termJaccard = 0.5 * (1.0 - jaccard);

    const d = termCat + termMacro + termTvl + termJaccard;
    scored.push({ entry, d });
  }

  scored.sort((a, b) => {
    const diff = a.d - b.d;
    if (Math.abs(diff) > 1e-12) {
      return diff;
    }
    return a.entry.slug.localeCompare(b.entry.slug);
  });

  return scored.slice(0, 3).map((item) => ({
    slug: item.entry.slug,
    name: item.entry.name,
    category: item.entry.category,
    tvl_usd: item.entry.tvl_usd,
    mcap_usd: item.entry.mcap_usd,
    ratio: item.entry.tvl_usd > 0 ? round4(item.entry.mcap_usd / item.entry.tvl_usd) : 0,
    distance: round4(item.d),
  }));
}

// ---------------- §3 Farm Step Templates ----------------

export interface StepTemplate {
  text: string;
  cost: string;
  time: string;
}

export interface FarmStep {
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
    text: 'Reallocate dedicated farming capital to FARM tier: redirect active airdrop bankroll from SKIP (P_launch < 0.25) to verified FARM protocols where points verifiably convert to pre-token TGE distribution.',
    cost: '$0-$5 gas',
    time: '5 min',
  },
];

export const FARM_STEP1_TEMPLATE: StepTemplate = {
  text: 'Route capital via low-fee rail on {exec}: Bridge {min} in USDC, ETH, or native gas to {exec} using native bridge or CCTP with estimated round-trip hard cost {gas}.',
  cost: '{g1}',
  time: '5-10 min',
};

export const FARM_STEP1_TEMPLATE_ETH: StepTemplate = {
  text: 'Fund wallet on Ethereum mainnet: prepare {min} in USDC or ETH (round-trip gas+bridge budget {total_hard}).',
  cost: '{g1}',
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
  cost: '{min} capital, {g2} gas',
  time: '15 min',
};

export const FARM_STEP3_TEMPLATES: readonly StepTemplate[] = [
  {
    text: 'Optimize maker-fee & OI tier: use post-only limit orders near mid-spread on {name} to capture fee rebates, build multi-day open interest, and avoid wash-trade filters.',
    cost: '{g3}',
    time: '10 min',
  },
  {
    text: 'Compound ecosystem multipliers: route {name} LP receipts or bridged balances through verified native gauges/quests on {exec} to stack protocol and chain points.',
    cost: '{g3}',
    time: '10 min',
  },
  {
    text: 'Stack receipt token for multiplier boost: deploy {name} receipt tokens into approved secondary liquidity venues (Pendle, Kamino Multiply, Morpho) to capture 2x-5x boosted points stacking.',
    cost: '{g3}',
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
    cost: '{g5}',
    time: '10-15 min',
  },
  {
    text: 'IL & emission exit guard: pull liquidity if 7d impermanent loss exceeds fee APR + estimated points yield, or pool TVL dilutes >2x without matching volume growth.',
    cost: '{g5}',
    time: '10-15 min',
  },
  {
    text: 'Active risk guard and async exit trigger: monitor withdrawal queues (ERC-7540 unbonding 1-7 days), secondary market peg (>0.5% discount), or TVL dilution >2x; unwind position early if thresholds breach.',
    cost: '{g5}',
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

export function fillSlot(
  text: string,
  vars: {
    name: string;
    exec: string;
    min: string;
    gas: string;
    hold: string;
    g1?: string;
    g2?: string;
    g3?: string;
    g4?: string;
    g5?: string;
    total_hard?: string;
  },
): string {
  return text
    .replace(/{name}/g, vars.name)
    .replace(/{exec}/g, vars.exec)
    .replace(/{min}/g, vars.min)
    .replace(/{gas}/g, vars.gas)
    .replace(/{hold}/g, vars.hold)
    .replace(/{g1}/g, vars.g1 ?? '')
    .replace(/{g2}/g, vars.g2 ?? '')
    .replace(/{g3}/g, vars.g3 ?? '')
    .replace(/{g4}/g, vars.g4 ?? '')
    .replace(/{g5}/g, vars.g5 ?? '')
    .replace(/{total_hard}/g, vars.total_hard ?? '');
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Maintain position per protocol schedule.`;
  return s;
}

export function farmSteps(
  protocol: SnapshotProtocol,
  verdict: 'farm' | 'watch' | 'skip',
  roiResult: RoiResult,
): FarmStep[] {
  const [s1, s2, s3, s4, s5] = stepCosts(roiResult);
  const vars = {
    name: protocol.name,
    exec: roiResult.exec_chain,
    min: `$${roiResult.k_min.toLocaleString('en-US')}`,
    gas: `$${roiResult.c_hard.toFixed(2)}`,
    total_hard: `$${roiResult.c_hard.toFixed(2)}`,
    hold: String(roiResult.hold_days),
    g1: s1,
    g2: s2,
    g3: s3,
    g4: s4,
    g5: s5,
  };

  if (verdict === 'skip') {
    return SKIP_TEMPLATES.map((t) => ({
      text: fillSlot(t.text, vars),
      cost: fillSlot(t.cost, vars),
      time: t.time,
    }));
  }

  const s1Template =
    roiResult.exec_chain === 'Ethereum' ? FARM_STEP1_TEMPLATE_ETH : FARM_STEP1_TEMPLATE;
  const s2Idx = getFarmStep2Variant(protocol.category);
  const s3Idx = getFarmStepGroup(protocol.category);
  const s3Template = FARM_STEP3_TEMPLATES[s3Idx]!;
  const s4Template = FARM_STEP4_TEMPLATES[s3Idx]!;
  const s5Template = FARM_STEP5_TEMPLATES[s3Idx]!;

  return [
    {
      text: fillSlot(s1Template.text, vars),
      cost: fillSlot(s1Template.cost, vars),
      time: s1Template.time,
    },
    {
      text: fillSlot(FARM_STEP2_TEMPLATES[s2Idx]!, vars),
      cost: fillSlot(FARM_STEP2_META.cost, vars),
      time: FARM_STEP2_META.time,
    },
    {
      text: fillSlot(s3Template.text, vars),
      cost: fillSlot(s3Template.cost, vars),
      time: s3Template.time,
    },
    {
      text: fillSlot(s4Template.text, vars),
      cost: fillSlot(s4Template.cost, vars),
      time: s4Template.time,
    },
    {
      text: fillSlot(s5Template.text, vars),
      cost: fillSlot(s5Template.cost, vars),
      time: s5Template.time,
    },
  ];
}
