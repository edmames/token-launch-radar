// lib/farm.ts: Costed Farm ROI engine, nearest live comps, and farm step templates
// radar-5.2 Stage C implementation. Fully deterministic.

import { macroGroup } from './model.ts';
import { round250, roundJs } from './stats.ts';

// ---------------- §1 Blueprint & Gas Engine ----------------

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
 * Returns (setup_min, weekly_min, base_tx) per radar-5.2 blueprint.
 */
export function blueprint(cat: string | null): [number, number, number] {
  if (
    cat === 'Derivatives' ||
    cat === 'Prediction Market' ||
    cat === 'Interest Rate Derivatives'
  ) {
    return [105, 10, 8];
  }
  if (cat === 'Dexs' || cat === 'Chain') {
    return [95, 10, 6];
  }
  return [85, 10, 4];
}

/**
 * Finds the cheapest chain from protocol chains list for the specified tx count.
 */
export function getCheapestChain(
  p: { chains?: string[] } | string[],
  tx: number,
): [string, number, number] {
  const chainList = Array.isArray(p) ? p : (p.chains ?? []);
  let best: [number, string, number, number] | null = null;
  for (const ch of chainList) {
    const [g, b] = GAS_TABLE[ch] ?? GAS_DEFAULT;
    const cost = b + tx * g;
    if (best === null || cost < best[0]) {
      best = [cost, ch, g, b];
    }
  }
  if (best === null) {
    return ['(none)', GAS_DEFAULT[0], GAS_DEFAULT[1]];
  }
  return [best[1], best[2], best[3]];
}

// ---------------- §2 Scenario ROI Engine ----------------

export interface Scenario {
  depositMode: 'plan' | '1000' | '3000' | '10000' | '30000';
  dropShare: number;
  horizonWk: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  depositMode: 'plan',
  dropShare: 0.07,
  horizonWk: 12,
};

export function depositFor(
  tvl: number,
  mode: 'plan' | '1000' | '3000' | '10000' | '30000',
): number {
  if (mode === 'plan') {
    return Math.max(1000.0, Math.min(10000.0, round250(0.0002 * tvl)));
  }
  return Number(mode);
}

export interface RoiScenarioResult {
  deposit: number;
  drop: number;
  fees: number;
  net: number;
  net_hr: number;
  tbill: number;
  hands_on_hours: number;
  tx_count: number;
  be_drop_share: number;
  be_token_odds: number;
  exit_tvl: number;
  exec_chain: string;
  gas: number;
  bridge: number;
}

export function roiFor(
  row: {
    implied: number;
    v50: number;
    tvl: number;
    category: string | null;
    chains?: string[];
  },
  scenario: Scenario,
  p5_7d: number,
): RoiScenarioResult {
  const deposit = depositFor(row.tvl, scenario.depositMode);
  const drop = (row.implied * scenario.dropShare * deposit) / (row.tvl + deposit);

  const [setup, weekly, baseTx] = blueprint(row.category);
  const hours = (setup + weekly * scenario.horizonWk) / 60.0;
  const tx = baseTx + scenario.horizonWk;
  const [execChain, gas, bridge] = getCheapestChain(row.chains ?? [], tx);
  const fees = 1.00 + bridge + tx * gas;
  const net = drop - fees;
  const netHr = net / hours;
  const tbill = (deposit * 0.04 * scenario.horizonWk) / 52.0;

  const beDropShare = fees / Math.max(1e-6, (row.implied * deposit) / (row.tvl + deposit));
  const beTokenOdds = fees / Math.max(1e-6, (row.v50 * scenario.dropShare * deposit) / (row.tvl + deposit));
  const exitTvl = row.tvl * (1.0 + p5_7d / 100.0);

  return {
    deposit,
    drop,
    fees,
    net,
    net_hr: netHr,
    tbill,
    hands_on_hours: hours,
    tx_count: tx,
    be_drop_share: beDropShare,
    be_token_odds: beTokenOdds,
    exit_tvl: exitTvl,
    exec_chain: execChain,
    gas,
    bridge,
  };
}

export function matrix3x4(
  row: {
    implied?: number;
    implied_value_usd?: number;
    v50: number;
    tvl: number;
    category: string | null;
    chains?: string[];
  },
  horizonWk: number = 12,
  p5_7d: number = -16.980155,
): number[][] {
  const implied = row.implied_value_usd ?? row.implied ?? 0;
  const shares = [0.035, 0.07, 0.14];
  const deposits: Array<'1000' | '3000' | 'plan' | '30000'> = ['1000', '3000', 'plan', '30000'];
  const res: number[][] = [];
  for (const s of shares) {
    const rowNets: number[] = [];
    for (const d of deposits) {
      const r = roiFor(
        { implied, v50: row.v50, tvl: row.tvl, category: row.category, chains: row.chains },
        { depositMode: d, dropShare: s, horizonWk },
        p5_7d,
      );
      rowNets.push(roundJs(r.net * 100) / 100);
    }
    res.push(rowNets);
  }
  return res;
}

// ---------------- §3 Nearest Live Comps (k=8) ----------------

export interface CompPoolEntry {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  macro_group: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  g7d: number | null;
  oof_pred: number;
}

export interface LiveComp {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  held_out: number;
  distance: number;
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
  k: number = 8,
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

  return scored.slice(0, k).map((item) => ({
    slug: item.entry.slug,
    name: item.entry.name,
    category: item.entry.category,
    tvl_usd: item.entry.tvl_usd,
    mcap_usd: item.entry.mcap_usd,
    ratio: item.entry.tvl_usd > 0 ? round4(item.entry.mcap_usd / item.entry.tvl_usd) : 0,
    held_out: item.entry.oof_pred > 0 ? round4(item.entry.mcap_usd / item.entry.oof_pred) : 0,
    distance: round4(item.d),
  }));
}

// ---------------- §4 Farm Step Generator (10 Steps / 3 Skip) ----------------

export interface FarmStep {
  n: number;
  role: 'SETUP' | 'VERIFY' | 'FUND' | 'RISK' | 'CORE' | 'DEEPEN' | 'CADENCE' | 'WATCH' | 'RECORD' | 'UNWIND' | 'DISQUALIFY' | 'RATIONALE' | 'STANDBY';
  text: string;
  cost_usd: number;
  time_min: number;
}

export const STEP_TEMPLATES = {
  farm: [
    'Configure dedicated Web3 wallet and ensure RPC endpoints are active for {exec_chain}. Review {name} protocol architecture on defillama.com/protocol/{slug} before initiating interactions.',
    'Verify smart contract deployment and canonical bridge contracts for {name} on {exec_chain}. Confirm protocol addresses match the official registry on defillama.com/protocol/{slug}.',
    'Bridge and fund wallet on {exec_chain} with planned deposit of ${deposit} ({pct_tvl}% of {name}\'s TVL). Account for initial network bridge fee and deposit transaction gas.',
    'Establish risk bounds for {category} protocol {name}. Set stop-loss alert if TVL drops below ${exit_tvl} (the {p5}% 7-day quantile drawdown threshold) to trigger immediate de-risking.',
    'Deploy ${deposit} into primary {category} liquidity pool or collateral contract of {name} on {exec_chain} to establish baseline active farming balance.',
    'Engage secondary protocol features on {name} ({category}) across {exec_chain} to maximize volume and contract interaction footprint according to {horizon}-week blueprint.',
    'Maintain weekly cadence for {horizon} weeks on {exec_chain}: compound yields, claim reward checkpoints, and rebalance position on {name} to preserve active user qualification.',
    'Monitor weekly protocol performance for {name}. Check defillama.com/protocol/{slug} weekly to verify TVL stays safely above ${exit_tvl} threshold ({p5}% safety line).',
    'Log all interaction hashes, cumulative gas fees, and claimed rewards for {name} on {exec_chain} to track net returns against projected {net} ({net_hr}/hr).',
    'At conclusion of {horizon}-week farming plan, withdraw ${deposit} plus accumulated rewards from {name} on {exec_chain}, bridge capital back, and finalize net realization.',
  ],
  skip: [
    'Disqualification filter triggered for {name} on defillama.com/protocol/{slug}: {skip_reason} (P_odds = {p_odds_pct}%, Net EV = {net}). Capital deployment rejected.',
    'Economic analysis confirms farming {name} on {exec_chain} yields negative or sub-threshold return ({net} net vs ${fees} fees). Capital should not be allocated.',
    'Standby instruction: No capital deployed ($0 gas, $0 deposit). Add {name} to watchlist for structural governance or TVL inflection before re-evaluating.',
  ],
};

function formatUsd(x: number): string {
  return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedUsd(x:number):string{return`${x <0?'-$':'$'}${Math.abs(x).toFixed(2)}`;}

export function farmSteps10(
  row: {
    slug: string;
    name: string;
    category: string | null;
    chains?: string[];
    tvl_usd: number;
    implied_value_usd?: number;
    implied?: number;
    v50?: number;
    p_odds?: number;
    model?: { v50: number; p_launch: number };
    roi?: {
      deposit: number;
      drop: number;
      fees: number;
      net: number;
      net_hr: number;
      exit_tvl: number;
      exec_chain: string;
      gas: number;
      bridge: number;
      hands_on_hours: number;
    };
  },
  scenario: Scenario = DEFAULT_SCENARIO,
  p5_7d: number = -16.980155,
): FarmStep[] {
  const implied = row.implied_value_usd ?? row.implied ?? 0;
  const v50 = row.v50 ?? row.model?.v50 ?? 0;
  const tvl = row.tvl_usd;
  const rRoi = row.roi ?? roiFor({ implied, v50, tvl, category: row.category, chains: row.chains }, scenario, p5_7d);

  const [setupMin, , baseTx] = blueprint(row.category);
  const horizon = scenario.horizonWk;

  // Exact cent partition
  const totalCents = Math.round(rRoi.fees * 100);
  const bridgeCents = Math.round(rRoi.bridge * 100);
  const gas1TxCents = Math.round(rRoi.gas * 100);
  const unwindCents = 100 + gas1TxCents; // $1.00 withdraw + 1 exit tx
  const fundCents = bridgeCents + gas1TxCents; // bridge + 1 deposit tx
  const coreCents = gas1TxCents; // 1 interaction tx
  const deepenTx = baseTx - 3;
  const deepenCents = Math.round(deepenTx * rRoi.gas * 100);
  const cadenceCents = totalCents - (fundCents + coreCents + deepenCents + unwindCents);

  const costCents = [0, 0, fundCents, 0, coreCents, deepenCents, cadenceCents, 0, 0, unwindCents];

  // Exact minute partition
  const riskMin = setupMin - 70;
  const cadenceMin = 5 * horizon;
  const watchMin = 3 * horizon;
  const recordMin = 2 * horizon;
  const minutes = [15, 10, 15, riskMin, 10, 10, cadenceMin, watchMin, recordMin, 10];

  const pctTvl = tvl > 0 ? (rRoi.deposit / tvl * 100).toFixed(3) : '0.000';
  const exitTvlStr = formatUsd(rRoi.exit_tvl);
  const p5Str = Math.abs(p5_7d).toFixed(2);

  const params: Record<string, string> = {
    slug: row.slug,
    name: row.name,
    exec_chain: rRoi.exec_chain,
    deposit: formatUsd(rRoi.deposit),
    pct_tvl: pctTvl,
    exit_tvl: exitTvlStr,
    p5: p5Str,
    category: row.category ?? 'DeFi',
    horizon: String(horizon),
    drop: rRoi.drop.toFixed(2),
    fees: rRoi.fees.toFixed(2),
    net: fmtSignedUsd(rRoi.net),
    net_hr: fmtSignedUsd(rRoi.net_hr),
  };

  const roles: Array<FarmStep['role']> = [
    'SETUP', 'VERIFY', 'FUND', 'RISK', 'CORE',
    'DEEPEN', 'CADENCE', 'WATCH', 'RECORD', 'UNWIND',
  ];

  const steps: FarmStep[] = [];
  for (let i = 0; i < 10; i++) {
    let txt = STEP_TEMPLATES.farm[i]!;
    for (const [k, v] of Object.entries(params)) {
      txt = txt.replaceAll(`{${k}}`, v);
    }
    steps.push({
      n: i + 1,
      role: roles[i]!,
      text: txt,
      cost_usd: costCents[i]! / 100,
      time_min: minutes[i]!,
    });
  }

  // Hard Invariants Assertion
  const sumCost = steps.reduce((sum, s) => sum + Math.round(s.cost_usd * 100), 0);
  if (sumCost !== totalCents) {
    throw new Error(`farmSteps10 cost sum invariant failed: ${sumCost} != ${totalCents}`);
  }
  const sumMin = steps.reduce((sum, s) => sum + s.time_min, 0);
  const targetMin = Math.round(rRoi.hands_on_hours * 60);
  if (sumMin !== targetMin) {
    throw new Error(`farmSteps10 time sum invariant failed: ${sumMin} != ${targetMin}`);
  }

  return steps;
}

export function skipSteps3(
  row: {
    slug: string;
    name: string;
    category: string | null;
    chains?: string[];
    tvl_usd: number;
    implied_value_usd?: number;
    implied?: number;
    v50?: number;
    p_odds?: number;
    model?: { v50: number; p_launch: number };
    roi?: {
      deposit: number;
      drop: number;
      fees: number;
      net: number;
      net_hr: number;
      exit_tvl: number;
      exec_chain: string;
      gas: number;
      bridge: number;
      hands_on_hours: number;
    };
  },
  scenario: Scenario = DEFAULT_SCENARIO,
  p5_7d: number = -16.980155,
): FarmStep[] {
  const implied = row.implied_value_usd ?? row.implied ?? 0;
  const v50 = row.v50 ?? row.model?.v50 ?? 0;
  const tvl = row.tvl_usd;
  const rRoi = row.roi ?? roiFor({ implied, v50, tvl, category: row.category, chains: row.chains }, scenario, p5_7d);
  const pOdds = row.p_odds ?? row.model?.p_launch ?? 0;

  const reasons: string[] = [];
  if (pOdds < 0.25) {
    reasons.push('structural launch probability filter flags P_odds < 0.25');
  }
  if (rRoi.net <= 0) {
    reasons.push('projected net return is negative or zero after fees');
  }
  const skipReason = reasons.length > 0 ? reasons.join(' and ') : 'economic hurdle not met';

  const params: Record<string, string> = {
    slug: row.slug,
    name: row.name,
    exec_chain: rRoi.exec_chain,
    deposit: formatUsd(rRoi.deposit),
    category: row.category ?? 'DeFi',
    drop: rRoi.drop.toFixed(2),
    fees: rRoi.fees.toFixed(2),
    net: fmtSignedUsd(rRoi.net),
    net_hr: fmtSignedUsd(rRoi.net_hr),
    skip_reason: skipReason,
    p_odds_pct: (pOdds * 100).toFixed(1),
  };

  const roles: Array<FarmStep['role']> = ['DISQUALIFY', 'RATIONALE', 'STANDBY'];
  const steps: FarmStep[] = [];
  for (let i = 0; i < 3; i++) {
    let txt = STEP_TEMPLATES.skip[i]!;
    for (const [k, v] of Object.entries(params)) {
      txt = txt.replaceAll(`{${k}}`, v);
    }
    steps.push({
      n: i + 1,
      role: roles[i]!,
      text: txt,
      cost_usd: 0,
      time_min: 0,
    });
  }

  return steps;
}
