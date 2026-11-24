// lib/model.ts: Token Radar model radar-6.0
// Stage A (locked Huber size-curve) + Stage B (Zero-Regex L2 Logistic + Conditional t90 Forward Odds)
// Zero hardcoded protocol names, zero service-name regexes. Fully deterministic.
import {
  accScore,
  brierScore,
  clip,
  dot,
  huberIrls,
  logLoss,
  median,
  Mulberry32,
  quantileSorted,
  round250,
  roundJs,
  sigmoid,
  solveLinear,
} from './stats.ts';
import {
  GAS_DEFAULT,
  GAS_TABLE,
  blueprint,
  farmSteps10,
  getCheapestChain,
  matrix3x4,
  nearestComps,
  roiFor,
  skipSteps3,
  STEP_TEMPLATES,
  DEFAULT_SCENARIO,
} from './farm.ts';
import type {
  CompPoolEntry,
  LiveComp,
  RoiScenarioResult,
  FarmStep,
  Scenario,
} from './farm.ts';

export const MODEL_VERSION = 'radar-6.0';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export const HUBER_DELTA = 0.75;
export const HUBER_ITERS = 20;
export const BOOT_SEED = 20261114;
export const BOOT_REFITS = 200;
export const LOGIT_LAMBDAS = [0.25, 1.0, 4.0];
export const LOGIT_CAT_LAMBDAS = [0.5, 1.5, 4.0, 10.0];

export const NON_LAUNCH = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
export const NON_LAUNCH_CATEGORIES = NON_LAUNCH;
export const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export const MACRO_GROUPS: Record<string, Set<string>> = {
  Trading: new Set([
    'Derivatives',
    'Dexs',
    'Prediction Market',
    'Basis Trading',
    'Interest Rate Derivatives',
  ]),
  Credit: new Set([
    'Lending',
    'Uncollateralized Lending',
    'Yield',
    'CDP',
    'Dual-Token Stablecoin',
    'Restaking',
    'Collateral Markets',
    'Leveraged Farming',
  ]),
  Vaults: new Set([
    'Onchain Capital Allocator',
    'RWA',
    'Yield Aggregator',
    'Liquidity Manager',
    'CDP Manager',
    'CeDeFi',
    'Stablecoin Wrapper',
    'Staking Pool',
    'Anchor BTC',
    'Decentralized BTC',
    'Farm',
    'Indexes',
    'Insurance',
    'Governance Incentives',
    'Risk Curators',
  ]),
  Infra: new Set([
    'Chain',
    'Cross Chain Bridge',
    'Payments',
    'Crypto Card Issuer',
    'OTC Marketplace',
  ]),
};

export const MACRO_EXT: Record<string, string> = {
  Options: 'Trading',
  DOR: 'Trading',
  'Collateral Management': 'Credit',
  'AI Agents': 'Infra',
  'Decentralized AI': 'Infra',
  Launchpad: 'Infra',
  'NFT Marketplace': 'Infra',
  Privacy: 'Infra',
  'Token Locker': 'Vaults',
  Bridge: 'Infra',
  'Canonical Bridge': 'Infra',
  'Liquid Staking': 'Vaults',
  'Liquid Restaking': 'Vaults',
  'Restaked BTC': 'Vaults',
  'Algo-Stables': 'Credit',
  'Options Vault': 'Trading',
  'Reserve Currency': 'Vaults',
  'Stablecoin Issuer': 'Credit',
  Synthetics: 'Trading',
};

const _CAT2MACRO = new Map<string, string>();
for (const [g, cs] of Object.entries(MACRO_GROUPS)) {
  for (const c of cs) _CAT2MACRO.set(c, g);
}
for (const [c, g] of Object.entries(MACRO_EXT)) {
  _CAT2MACRO.set(c, g);
}

export function macroGroup(cat: string | null): string {
  return _CAT2MACRO.get(cat || 'Unknown') ?? 'Trading';
}

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
  y?: number;
  z?: number;
  age_yr?: number;
  tvl_b?: number;
  chains_b?: number;
  _ctrl_peer?: SnapshotProtocol;
}

export interface Snapshot {
  as_of: string;
  source: string;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function normWord(s: string | null): string {
  const str = (s ?? '').trim();
  if (!str) return '';
  const w = str.split(/[\s_-]+/)[0]!.toLowerCase();
  return w.replace(/[^a-z0-9]/g, '');
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !NON_LAUNCH.has(p.category || '') &&
    !VERSIONED.test(p.name)
  );
}

export function ageDays(asOfStr: string, listedAtStr: string | null): number | null {
  if (listedAtStr === null) return null;
  const [y0, m0, d0] = asOfStr.split('-').map(Number);
  const [y1, m1, d1] = listedAtStr.split('-').map(Number);
  const t0 = Date.UTC(y0!, m0! - 1, d0!);
  const t1 = Date.UTC(y1!, m1! - 1, d1!);
  return Math.max(0, Math.round((t0 - t1) / (24 * 3600 * 1000)));
}

export { blueprint, getCheapestChain };

export function computeChainMedians(
  cohort: { change_7d?: number | null; chains?: string[] }[],
): Map<string, number> {
  const byChain = new Map<string, number[]>();
  for (const p of cohort) {
    if (p.change_7d !== null && p.change_7d !== undefined) {
      for (const c of p.chains ?? []) {
        let list = byChain.get(c);
        if (!list) {
          list = [];
          byChain.set(c, list);
        }
        list.push(p.change_7d);
      }
    }
  }
  const res = new Map<string, number>();
  for (const [c, list] of byChain.entries()) {
    res.set(c, median(list));
  }
  return res;
}

export function calcX3(
  p: { change_7d?: number | null; chains?: string[] },
  medians: Map<string, number>,
): number {
  if (p.change_7d === null || p.change_7d === undefined) return 0.0;
  const meds: number[] = [];
  for (const c of p.chains ?? []) {
    const m = medians.get(c);
    if (m !== undefined) meds.push(m);
  }
  const gbar = meds.length > 0 ? meds.reduce((a, b) => a + b, 0.0) / meds.length : 0.0;
  return clip(p.change_7d - gbar, -40.0, 80.0) / 100.0;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') {
    throw new SnapshotError('snapshot.json has no source');
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError('snapshot.json has no protocols array');
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is missing required fields`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)
          ? p.change_7d
          : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd)
          ? p.mcap_usd
          : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: o.as_of,
    source: o.source,
    protocols,
    watchlist: o.watchlist as string[],
  };
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
  implied_p25_usd: number;
  implied_p75_usd: number;
  is_watchlist: boolean;
  verdict: 'farm' | 'marginal' | 'skip';
  model: {
    v50: number;
    v10: number;
    v25: number;
    v75: number;
    v90: number;
    p_launch: number;
    pi: number;
    F: number;
    S: number;
    y_hat: number;
    med_r: number;
    age_days: number | null;
    gate_code: string;
    rank_lo: number;
    rank_hi: number;
  };
  roi: {
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
  };
  farm_steps: string[];
  farm_steps_detail?: FarmStep[];
  nearest_comps: LiveComp[];
  matrix?: number[][];
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
  implied_p25_usd: number;
  implied_p75_usd: number;
  v50_usd: number;
  v10_usd: number;
  v25_usd: number;
  v75_usd: number;
  v90_usd: number;
  p_launch: number;
  pi: number;
  F: number;
  S: number;
  verdict: 'farm' | 'marginal' | 'skip';
  is_watchlist: boolean;
  gate_code: string;
  rank_lo: number;
  rank_hi: number;
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
  comp_idx?: number[];
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
  model_version: 'radar-6.0';
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration_count: number;
  p5_7d: number;
  median_age_yr: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps_pool?: CompPoolEntry[];
  validation: {
    stage_a: {
      match: {
        n: number;
        table: {
          term: string;
          loo_typical_miss: number;
          wf_typical_miss: number;
          t_stat: number | null;
          status: string;
        }[];
        kept_feats: string[];
        kept_offset_group: string | null;
        kept_offset_lambdas: number[] | null;
        final_loo: number;
        final_wf: number;
        conformal_loo: {
          q10: number;
          q25: number;
          med_r: number;
          q75: number;
          q90: number;
          coverage: {
            within_x3: number;
            coverage_p25_p75: number;
            coverage_p10_p90: number;
          };
        };
        conformal_wf: {
          q10: number;
          q25: number;
          med_r: number;
          q75: number;
          q90: number;
          coverage: {
            within_x3: number;
            coverage_p25_p75: number;
            coverage_p10_p90: number;
          };
        };
      };
      all: {
        n: number;
        table: {
          term: string;
          loo_typical_miss: number;
          wf_typical_miss: number;
          t_stat: number | null;
          status: string;
        }[];
      };
      final_fit: {
        beta: number[];
        beta_se: Record<string, number>;
        med_r: number;
        q10: number;
        q25: number;
        q75: number;
        q90: number;
      };
      oof?: { slug: string; oof_pred: number }[];
    };
     stage_b: {
       cohort: string;
       n_protocols: number;
       ablation: {
         term: string;
        brier_10fold: number;
        acc_10fold: number;
        brier_wf: number;
        acc_wf: number;
        status: string;
        cv10_mode_lambda: number;
        cv10_mode_lam_cat: number;
        wf_lambda: number;
        wf_lam_cat: number;
      }[];
      kept_terms: string[];
      baseline_wf_brier: number;
      final_kept_wf_brier: number;
      wf_brier_margin: number;
      final_fit: {
         beta: number[];
        beta_se: Record<string, number>;
        alpha_c: Record<string, number>;
        t90: number;
        lambda: number;
        lam_cat: number;
        p0_base: number;
      };
      bootstrap: {
         n_refits: number;
        seed: number;
        se: Record<string, number>;
        category_offsets_spread: Record<string, { min: number; max: number; mean: number }>;
      };
    };
    gates: Record<string, [boolean, string]>;
    ledger: {
      groups: [string, number][];
      total: number;
    };
    verdicts: {
      counts: Record<string, number>;
      farm_count_at_1_25h: number;
    };
    audit: {
      rc_skip: number;
      rc_in_top50: number;
      violations: any[];
    };
  };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        cmpStr(a.slug, b.slug),
    )
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

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (!steps || steps.length < 3 || steps.length > 12) {
      return `${r.slug} has ${steps?.length ?? 0} farm steps`;
    }
    for (const s of steps) {
      if (typeof s !== 'string' || s.length < 20 || s.length > 600) {
        return `${r.slug} has a farm step of ${typeof s === 'string' ? s.length : typeof s} characters`;
      }
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

export function buildRadar(snapshot: Snapshot): {
  board: BoardRow[];
  radar: RadarData;
} {
  const asOf = snapshot.as_of;
  const protocols = snapshot.protocols;
  const watchlist = snapshot.watchlist || [];

  // Live brands and chains for structural gates
  const liveBrands = new Set<string>();
  for (const p of protocols) {
    if (!isPreToken(p)) {
      const fw = normWord(p.name);
      if (fw.length >= 4) liveBrands.add(fw);
      if (p.symbol) {
        const sw = normWord(p.symbol);
        if (sw.length >= 4) liveBrands.add(sw);
      }
    }
  }

  const liveEcoChains = new Set<string>();
  for (const p of protocols) {
    if (!isPreToken(p)) {
      for (const ch of p.chains || []) {
        liveEcoChains.add(ch);
      }
    }
  }

  function computeGates(p: { category: string | null; name: string; chains?: string[]; tvl_usd?: number }): [number, number, number] {
    const fw = normWord(p.name);
    const isPegged = (
      p.category === 'CDP' &&
      /^usd[a-z0-9]{1,2}$/i.test((p.name || '').trim()) &&
      (p.tvl_usd || 0) > 500_000_000
    );
    const dParent = ((fw.length >= 4 && liveBrands.has(fw)) || isPegged) ? 0.05 : 1.0;

    let chainMatch = false;
    for (const ch of p.chains || []) {
      const cw = normWord(ch);
      if (cw.length >= 4 && fw.length >= 4 && (cw === fw || fw.startsWith(cw) || cw.startsWith(fw))) {
        chainMatch = true;
      }
    }
    const dChainSub = (p.category === 'Chain' && (p.chains || []).length > 0 && !chainMatch) ? 0.15 : 1.0;

    let dNative = 1.0;
    if (p.category !== 'Chain') {
      for (const ch of p.chains || []) {
        const cw = normWord(ch);
        if (cw.length >= 4 && fw.length >= 4 && cw === fw && liveEcoChains.has(ch)) {
          dNative = 0.10;
          break;
        }
      }
    }
    return [dParent, dChainSub, dNative];
  }

  function gateCodeOf(d1: number, d2: number, d3: number): string {
    const codes: string[] = [];
    if (d1 < 1.0) codes.push('Parent ×0.05');
    if (d2 < 1.0) codes.push('Chain-Sub ×0.15');
    if (d3 < 1.0) codes.push('Native ×0.10');
    return codes.length > 0 ? codes.join('; ') : 'none';
  }

  // =====================================================================
  // STAGE A: Conditional Liquid Valuation
  // =====================================================================
  const L_match = protocols.filter((p) =>
    (p.mcap_usd || 0) > 0 &&
    (p.tvl_usd || 0) >= 1e6 &&
    p.category !== 'CEX' &&
    !NON_LAUNCH.has(p.category || '') &&
    !VERSIONED.test(p.name || '') &&
    p.listed_at !== null
  );
  L_match.sort((a, b) => cmpStr(a.slug, b.slug));
  const N_match = L_match.length;

  function runStageAAblation(cohort: any[], isControlAlarm = true) {
    const cohort_sorted = cohort.slice().sort((a, b) => cmpStr(a.slug, b.slug));
    const N = cohort_sorted.length;
    for (let i = 0; i < N; i++) {
      const p = cohort_sorted[i]!;
      p.z = Math.log(p.mcap_usd / p.tvl_usd);
      p.x_tvl = Math.log(p.tvl_usd / 1e8);
      p.macro = macroGroup(p.category);
      p.age_days = ageDays(asOf, p.listed_at)!;
      p.x_age = Math.log(1.0 + p.age_days);
      p.x_chains = Math.log(Math.max(1, (p.chains || []).length));
      p._ctrl_peer = cohort_sorted[(i + 1) % N]!;
    }

    const wf_cohort = cohort_sorted.slice().sort((a, b) => {
      const c = cmpStr(a.listed_at, b.listed_at);
      return c !== 0 ? c : cmpStr(a.slug, b.slug);
    });
    const start_wf = Math.max(Math.floor(0.40 * wf_cohort.length), 35);

    function evalModel(modelFn: (tr: any[], te: any, tr_meds: Map<string, number>) => number): [number, number] {
      const loo_misses: number[] = [];
      for (let i = 0; i < N; i++) {
        const tr = cohort_sorted.filter((_, j) => j !== i);
        const te = cohort_sorted[i]!;
        const tr_meds = computeChainMedians(tr);
        const zh = modelFn(tr, te, tr_meds);
        loo_misses.push(Math.exp(Math.abs(zh - te.z)));
      }
      const loo_typ = median(loo_misses);

      const wf_misses: number[] = [];
      for (let i = start_wf; i < wf_cohort.length; i++) {
        const te = wf_cohort[i]!;
        const tr = wf_cohort.filter((p) => p.listed_at < te.listed_at);
        if (tr.length < 35) continue;
        const tr_meds = computeChainMedians(tr);
        const zh = modelFn(tr, te, tr_meds);
        wf_misses.push(Math.exp(Math.abs(zh - te.z)));
      }
      const wf_typ = median(wf_misses);
      return [loo_typ, wf_typ];
    }

    function computeSlopeStability(test_feats: string[], candidate_feat: string): [number, number, number] {
      const full_meds = computeChainMedians(cohort_sorted);
      function row_f(p: any, meds: Map<string, number>): number[] {
        const vals = [1.0];
        for (const f of test_feats) {
          if (f === 'x3') vals.push(calcX3(p, meds));
          else if (f === 'x_ctrl') vals.push(calcX3(p._ctrl_peer, meds));
          else vals.push(p[f]);
        }
        return vals;
      }
      const X_full = cohort_sorted.map((p) => row_f(p, full_meds));
      const y_full = cohort_sorted.map((p) => p.z);
      const b_full = huberIrls(X_full, y_full);
      const cand_idx = test_feats.indexOf(candidate_feat) + 1;
      const b_cand = b_full[cand_idx]!;

      const rng = new Mulberry32(20261114);
      const boot_vals: number[] = [];
      for (let b = 0; b < 200; b++) {
        const sample = Array.from({ length: N }, () => cohort_sorted[Math.floor(rng.next() * N)]!);
        const s_meds = computeChainMedians(sample);
        const Xs = sample.map((p) => row_f(p, s_meds));
        const ys = sample.map((p) => p.z);
        const bs = huberIrls(Xs, ys);
        boot_vals.push(bs[cand_idx]!);
      }

      const mean_v = boot_vals.reduce((a, b) => a + b, 0.0) / boot_vals.length;
      const se_boot = Math.sqrt(boot_vals.reduce((a, b) => a + (b - mean_v) ** 2, 0.0) / (boot_vals.length - 1));
      const t_stat = se_boot > 1e-9 ? Math.abs(b_cand) / se_boot : Infinity;
      return [t_stat, b_cand, se_boot];
    }

    function makeLinearFn(
      feat_list: string[],
      offset_group: string | null = null,
      offset_lambdas: number[] | null = null,
    ) {
      return function (tr: any[], te: any, tr_meds: Map<string, number>): number {
        function row_feats(p: any): number[] {
          const vals = [1.0];
          for (const f of feat_list) {
            if (f === 'x3') vals.push(calcX3(p, tr_meds));
            else if (f === 'x_ctrl') vals.push(calcX3(p._ctrl_peer, tr_meds));
            else vals.push(p[f]);
          }
          return vals;
        }
        const X_tr = tr.map((p) => row_feats(p));
        const y_tr = tr.map((p) => p.z);
        const b = huberIrls(X_tr, y_tr);
        let zh = dot(b, row_feats(te));

        if (offset_group && offset_lambdas) {
          const resids = tr.map((p) => p.z - dot(b, row_feats(p)));
          const g_sums = new Map<string, number>();
          const g_counts = new Map<string, number>();
          for (let i = 0; i < tr.length; i++) {
            const g = tr[i][offset_group];
            const r = resids[i]!;
            g_sums.set(g, (g_sums.get(g) || 0) + r);
            g_counts.set(g, (g_counts.get(g) || 0) + 1);
          }
          let best_lam = offset_lambdas[0]!;
          let best_miss = Infinity;
          for (const lam of offset_lambdas) {
            const inner: number[] = [];
            for (let i = 0; i < tr.length; i++) {
              const p = tr[i]!;
              const r = resids[i]!;
              const g = p[offset_group];
              const s = (g_sums.get(g) || 0) - r;
              const c = (g_counts.get(g) || 0) - 1;
              const off = c > 0 ? s / (c + lam) : 0.0;
              const zh_in = dot(b, row_feats(p)) + off;
              inner.push(Math.exp(Math.abs(zh_in - p.z)));
            }
            const m = median(inner);
            if (m < best_miss) {
              best_miss = m;
              best_lam = lam;
            }
          }
          const g_te = te[offset_group];
          const count_te = g_counts.get(g_te) || 0;
          const off_te = count_te > 0 ? (g_sums.get(g_te) || 0) / (count_te + best_lam) : 0.0;
          zh += off_te;
        }
        return zh;
      };
    }

    // 1. Baseline
    const [loo_0, wf_0] = evalModel((tr) => median(tr.map((p) => p.z)));
    const rows: [string, number, number, number | null, string][] = [
      ['1. Flat median multiple (baseline)', loo_0, wf_0, null, 'baseline'],
    ];
    let kept_loo = loo_0;
    let kept_wf = wf_0;
    let kept_feats: string[] = [];
    let kept_offset_group: string | null = null;
    let kept_offset_lambdas: number[] | null = null;

    // 2. + size curve
    const [loo_size, wf_size] = evalModel(makeLinearFn(['x_tvl']));
    const [t_size, , ] = computeSlopeStability(['x_tvl'], 'x_tvl');
    const d_loo = kept_loo - loo_size;
    const d_wf = kept_wf - wf_size;
    const dual_keep = d_loo > 0 && d_wf > 0 && (d_loo >= 0.01 || d_wf >= 0.01);
    const passes = dual_keep && t_size >= 1.5;
    let status_size = 'tested, not kept';
    if (passes) {
      status_size = 'kept';
      kept_feats = ['x_tvl'];
      kept_loo = loo_size;
      kept_wf = wf_size;
    }
    rows.push(['2. + size curve, ln(TVL / $100M)', loo_size, wf_size, t_size, status_size]);

    // 3. + family effect & 4. + category effect
    const [loo_fam, wf_fam] = evalModel(makeLinearFn(kept_feats, 'macro', [8, 16, 32]));
    const [loo_cat, wf_cat] = evalModel(makeLinearFn(kept_feats, 'category', [16, 32, 64, 128]));

    const d_loo_fam = kept_loo - loo_fam;
    const d_wf_fam = kept_wf - wf_fam;
    const fam_passes = d_loo_fam > 0 && d_wf_fam > 0 && (d_loo_fam >= 0.01 || d_wf_fam >= 0.01);

    const d_loo_cat = kept_loo - loo_cat;
    const d_wf_cat = kept_wf - wf_cat;
    const cat_passes = d_loo_cat > 0 && d_wf_cat > 0 && (d_loo_cat >= 0.01 || d_wf_cat >= 0.01);

    const cat_beats_fam = loo_cat < loo_fam && wf_cat < wf_fam;

    let status_fam = 'tested, not kept';
    let status_cat = 'tested, not kept';

    if (fam_passes && cat_passes) {
      if (cat_beats_fam) {
        status_cat = 'kept';
        status_fam = 'tested, not kept';
        kept_offset_group = 'category';
        kept_offset_lambdas = [16, 32, 64, 128];
        kept_loo = loo_cat;
        kept_wf = wf_cat;
      } else {
        status_fam = 'kept';
        status_cat = 'tested, not kept';
        kept_offset_group = 'macro';
        kept_offset_lambdas = [8, 16, 32];
        kept_loo = loo_fam;
        kept_wf = wf_fam;
      }
    } else if (fam_passes && !cat_passes) {
      status_fam = 'kept';
      status_cat = 'tested, not kept';
      kept_offset_group = 'macro';
      kept_offset_lambdas = [8, 16, 32];
      kept_loo = loo_fam;
      kept_wf = wf_fam;
    } else if (cat_passes && !fam_passes) {
      status_cat = 'kept';
      status_fam = 'tested, not kept';
      kept_offset_group = 'category';
      kept_offset_lambdas = [16, 32, 64, 128];
      kept_loo = loo_cat;
      kept_wf = wf_cat;
    }
    rows.push(['3. + family effect (macro-group ridge)', loo_fam, wf_fam, null, status_fam]);
    rows.push(['4. + category effect (DefiLlama ridge)', loo_cat, wf_cat, null, status_cat]);

    const cands: [string, string][] = [
      ['5. + 7-day TVL growth (chain-demeaned)', 'x3'],
      ['6. + age, ln(1 + age_days)', 'x_age'],
      ['7. + chain count, ln(n_chains)', 'x_chains'],
      ['8. + control: growth of adjacent row', 'x_ctrl'],
    ];

    for (const [term_name, feat] of cands) {
      const test_feats = [...kept_feats, feat];
      const fn = makeLinearFn(test_feats, kept_offset_group, kept_offset_lambdas);
      const [lm, wm] = evalModel(fn);
      const [t_stat, , ] = computeSlopeStability(test_feats, feat);
      const d_l = kept_loo - lm;
      const d_w = kept_wf - wm;
      const dual_k = d_l > 0 && d_w > 0 && (d_l >= 0.01 || d_w >= 0.01);
      const term_passes = dual_k && t_stat >= 1.5;

      let status = '';
      if (feat === 'x_ctrl') {
        if (dual_k) {
          if (isControlAlarm) {
            throw new Error('LEAKAGE WARNING: negative control helped');
          } else {
            status = 'kept (LEAKAGE)';
          }
        } else {
          status = 'must not help (rejected)';
        }
      } else {
        if (term_passes) {
          status = 'kept';
          kept_feats.push(feat);
          kept_loo = lm;
          kept_wf = wm;
        } else {
          status = 'tested, not kept';
        }
      }
      rows.push([term_name, lm, wm, t_stat, status]);
    }

    return {
      rows,
      kept_feats,
      kept_offset_group,
      kept_offset_lambdas,
      final_loo: kept_loo,
      final_wf: kept_wf,
    };
  }

  const res_a = runStageAAblation(L_match, true);
  const kept_a_feats = res_a.kept_feats;
  const meds_match = computeChainMedians(L_match);
  const X_a_full = L_match.map((p) => [1.0, ...kept_a_feats.map((f) => f === 'x3' ? calcX3(p, meds_match) : p[f])]);
  const y_a_full = L_match.map((p) => p.z);
  const beta_a_full = huberIrls(X_a_full, y_a_full);

  // Conformal LOO
  const loo_resids: number[] = [];
  const loo_preds_raw: { slug: string; tvl_usd: number; zh: number }[] = [];
  for (let i = 0; i < L_match.length; i++) {
    const tr = L_match.filter((_, j) => j !== i);
    const te = L_match[i]!;
    const tr_meds = computeChainMedians(tr);
    function row_feats(p: any, meds: Map<string, number>): number[] {
      return [1.0, ...kept_a_feats.map((f) => f === 'x3' ? calcX3(p, meds) : p[f])];
    }
    const X_tr = tr.map((p) => row_feats(p, tr_meds));
    const y_tr = tr.map((p) => p.z);
    const b = huberIrls(X_tr, y_tr);
    const zh = dot(b, row_feats(te, tr_meds));
    loo_resids.push(te.z - zh);
    loo_preds_raw.push({ slug: te.slug, tvl_usd: te.tvl_usd, zh });
  }

  const s_loo_resids = loo_resids.slice().sort((a, b) => a - b);
  const q10_loo = quantileSorted(s_loo_resids, 0.10);
  const q25_loo = quantileSorted(s_loo_resids, 0.25);
  const med_r_loo = median(s_loo_resids);
  const q75_loo = quantileSorted(s_loo_resids, 0.75);
  const q90_loo = quantileSorted(s_loo_resids, 0.90);

  const oof_a: { slug: string; oof_pred: number }[] = loo_preds_raw.map((p) => ({
    slug: p.slug,
    oof_pred: p.tvl_usd * Math.exp(p.zh + med_r_loo),
  }));

  const cov_x3_loo = loo_resids.filter((r) => Math.exp(Math.abs(r)) <= 3.0).length / loo_resids.length;
  const cov_50_loo = loo_resids.filter((r) => q25_loo <= r && r <= q75_loo).length / loo_resids.length;
  const cov_80_loo = loo_resids.filter((r) => q10_loo <= r && r <= q90_loo).length / loo_resids.length;

  // Conformal WF
  const wf_cohort_a = L_match.slice().sort((a, b) => {
    const c = cmpStr(a.listed_at, b.listed_at);
    return c !== 0 ? c : cmpStr(a.slug, b.slug);
  });
  const start_wf_a = Math.max(Math.floor(0.40 * wf_cohort_a.length), 35);
  const wf_resids: number[] = [];
  for (let i = start_wf_a; i < wf_cohort_a.length; i++) {
    const te = wf_cohort_a[i]!;
    const tr = wf_cohort_a.filter((p) => p.listed_at < te.listed_at);
    if (tr.length < 35) continue;
    const tr_meds = computeChainMedians(tr);
    function row_feats(p: any, meds: Map<string, number>): number[] {
      return [1.0, ...kept_a_feats.map((f) => f === 'x3' ? calcX3(p, meds) : p[f])];
    }
    const X_tr = tr.map((p) => row_feats(p, tr_meds));
    const y_tr = tr.map((p) => p.z);
    const b = huberIrls(X_tr, y_tr);
    const zh = dot(b, row_feats(te, tr_meds));
    wf_resids.push(te.z - zh);
  }

  const s_wf_resids = wf_resids.slice().sort((a, b) => a - b);
  const q10_wf = quantileSorted(s_wf_resids, 0.10);
  const q25_wf = quantileSorted(s_wf_resids, 0.25);
  const med_r_wf = median(s_wf_resids);
  const q75_wf = quantileSorted(s_wf_resids, 0.75);
  const q90_wf = quantileSorted(s_wf_resids, 0.90);

  const cov_x3_wf = wf_resids.filter((r) => Math.exp(Math.abs(r)) <= 3.0).length / wf_resids.length;
  const cov_50_wf = wf_resids.filter((r) => q25_wf <= r && r <= q75_wf).length / wf_resids.length;
  const cov_80_wf = wf_resids.filter((r) => q10_wf <= r && r <= q90_wf).length / wf_resids.length;

  // L_all Audit
  const L_all = protocols.filter((p) =>
    (p.mcap_usd || 0) > 0 &&
    (p.tvl_usd || 0) >= 1e6 &&
    p.category !== 'CEX' &&
    p.listed_at !== null
  );
  const N_all = L_all.length;
  const res_a_all = runStageAAblation(L_all, false);

    // =====================================================================
    // STAGE B: Token Odds (Zero-Regex L2 Logistic + Conditional t90 Forward Odds)
    // p_now(i) = sigmoid(beta0 + alpha_c + beta_age*age_yr + beta_tvl*ln(TVL/$100M))
    // p_max(i) = p_now evaluated at t_target = max(t90, age_yr + 0.5)
    // P_odds(i) = clip((p_max - p_now) / (1 - p_now), 0.01, 0.95) * structural_gates
    // =====================================================================
    const NON_CEX = protocols.filter((p) => p.category !== 'CEX' && p.listed_at !== null);
    NON_CEX.sort((a, b) => cmpStr(a.slug, b.slug));
    const N_b = NON_CEX.length;

    for (let i = 0; i < N_b; i++) {
      const p = NON_CEX[i]!;
      p.y = isPreToken(p) ? 0 : 1;
      p.age_yr = ageDays(asOf, p.listed_at)! / 365.25;
      p.tvl_b = Math.log(Math.max(1.0, p.tvl_usd || 1.0) / 1e8);
      p.chains_b = Math.log(Math.max(1, (p.chains || []).length));
      p._ctrl_peer = NON_CEX[(i + 1) % N_b]!;
    }
  const ages_sorted_b = NON_CEX.map((p) => p.age_yr!).sort((a, b) => a - b);
  const median_age_yr_non_cex = median(ages_sorted_b);
  const t90_yr = quantileSorted(ages_sorted_b, 0.90);

  const cv_rows = NON_CEX.slice().sort((a, b) => {
    if (a.y !== b.y) return a.y! - b.y!;
    const cCat = cmpStr(a.category || '', b.category || '');
    if (cCat !== 0) return cCat;
    const tvlA = a.tvl_usd || 0;
    const tvlB = b.tvl_usd || 0;
    if (tvlA !== tvlB) return tvlA - tvlB;
    return cmpStr(a.slug, b.slug);
  });

  const folds_10: SnapshotProtocol[][] = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < cv_rows.length; i++) {
    folds_10[i % 10]!.push(cv_rows[i]!);
  }

  const wf_cohort_b = NON_CEX.slice().sort((a, b) => {
    const c = cmpStr(a.listed_at!, b.listed_at!);
    return c !== 0 ? c : cmpStr(a.slug, b.slug);
  });
  const start_wf_b = Math.max(Math.floor(0.40 * wf_cohort_b.length), 35);

  interface LogitOddsModel {
    beta: number[];
    alpha_c: Record<string, number>;
    feats: string[];
    use_cat: boolean;
    p0_base: number;
  }

  function getLogitVec(
    p: SnapshotProtocol,
    feats: string[],
    meds: Map<string, number>,
    ageOverride?: number,
  ): number[] {
    const res = [1.0];
    for (const f of feats) {
      if (f === 'age_yr') {
        const a = ageOverride !== undefined
          ? ageOverride
          : p.age_yr !== undefined
          ? p.age_yr
           : p.listed_at !== null
           ? ageDays(asOf, p.listed_at)! / 365.25
           : median_age_yr_non_cex;
         res.push(a);
       } else if (f === 'tvl_b') {
         res.push(Math.log(Math.max(1.0, p.tvl_usd || 1.0) / 1e8));
       } else if (f === 'x3') {
         res.push(calcX3(p, meds));
       } else if (f === 'chains_b') {
         res.push(Math.log(Math.max(1, (p.chains || []).length)));
       } else if (f === 'ctrl') {
         res.push(p._ctrl_peer ? calcX3(p._ctrl_peer, meds) : 0.0);
       }
      }
      return res;
  }

  /**
   * Strictly convex L2-penalized logistic regression with zero-sum category ridge
   * L = sum_i [ y_i ln(mu_i) + (1 - y_i) ln(1 - mu_i) ] - 0.5*lam*||beta_{1:}||^2 - 0.5*lam_cat*||alpha_c||^2
   * Solved by alternating Newton-Raphson on beta and exact 1D Newton on each alpha_c.
   */
  function fitLogit(
    train_rows: SnapshotProtocol[],
    feats: string[],
    use_cat: boolean,
    lam: number,
    lam_cat: number,
    meds: Map<string, number>,
  ): LogitOddsModel {
    const n = train_rows.length;
    const X = train_rows.map((p) => getLogitVec(p, feats, meds));
    const y_tr = train_rows.map((p) => p.y!);
    const p_dim = X[0]!.length;

      let y_sum = 0;
      for (let i = 0; i < n; i++) y_sum += y_tr[i]!;
      const p0_base = clip(y_sum / Math.max(1, n), 0.01, 0.99);

      const beta = new Array<number>(p_dim).fill(0.0);
      beta[0] = Math.log(p0_base / (1.0 - p0_base));

      const by_cat = new Map<string, number[]>();
      for (let idx = 0; idx < n; idx++) {
        const c = train_rows[idx]!.category || 'Unknown';
        let list = by_cat.get(c);
   if (!list) {
     list = [];
     by_cat.set(c, list);
   }
   list.push(idx);
  }
  const catKeys = Array.from(by_cat.keys()).sort();
  const alpha_c: Record<string, number> = {};
  for (const c of catKeys) alpha_c[c] = 0.0;

  const lin = new Array<number>(n).fill(beta[0]!);
  let prev_ll = -1e18;

  for (let iter = 0; iter < 14; iter++) {
    // 1. Newton step on beta (intercept unpenalized, ridge lam on slopes)
    const H: number[][] = Array.from({ length: p_dim }, () => new Array(p_dim).fill(0.0));
    const rhs = new Array<number>(p_dim).fill(0.0);

   for (let j = 0; j < n; j++) {
     const c = train_rows[j]!.category || 'Unknown';
     const co = use_cat ? (alpha_c[c] ?? 0.0) : 0.0;
     const mu = sigmoid(dot(X[j]!, beta) + co);
     const wj = Math.max(1e-6, mu * (1.0 - mu));
     const rj = y_tr[j]! - mu;
     const xj = X[j]!;
     for (let a = 0; a < p_dim; a++) {
       rhs[a]! += xj[a]! * rj;
       for (let b = 0; b < p_dim; b++) {
         H[a]![b]! += xj[a]! * wj * xj[b]!;
       }
     }
   }
   H[0]![0]! += 1e-6;
   for (let a = 1; a < p_dim; a++) {
     H[a]![a]! += lam;
     rhs[a]! -= lam * beta[a]!;
   }
   const dBeta = solveLinear(H, rhs);
   for (let a = 0; a < p_dim; a++) {
     beta[a] = clip(beta[a]! + clip(dBeta[a]!, -2.0, 2.0), -8.0, 8.0);
   }

    // 2. Per-category 1D Newton step + exact zero-sum centering
    if (use_cat && catKeys.length > 0) {
      for (let j = 0; j < n; j++) lin[j] = dot(X[j]!, beta);
      let sum_ac = 0.0;
              for (const c of catKeys) {
                const idxs = by_cat.get(c)!;
                const ac = alpha_c[c]!;
                let g_c = -lam_cat * ac;
                let h_c = lam_cat;
                for (let m = 0; m < idxs.length; m++) {
                  const j = idxs[m]!;
                  const mu = sigmoid(lin[j]! + ac);
                  g_c += y_tr[j]! - mu;
                  h_c += Math.max(1e-6, mu * (1.0 - mu));
                }
                const next_ac = clip(ac + clip(g_c / h_c, -1.5, 1.5), -4.0, 4.0);
                alpha_c[c] = next_ac;
                sum_ac += next_ac;
              }
              const mean_ac = sum_ac / catKeys.length;
              beta[0] = clip(beta[0]! + mean_ac, -8.0, 8.0);
              for (const c of catKeys) {
                alpha_c[c] = alpha_c[c]! - mean_ac;
              }
          }

          // 3. Convergence check on penalized log-likelihood
          let ll = 0.0;
          for (let j = 0; j < n; j++) {
            const c = train_rows[j]!.category || 'Unknown';
            const co = use_cat ? (alpha_c[c] ?? 0.0) : 0.0;
            const mu = clip(sigmoid(dot(X[j]!, beta) + co), 1e-9, 1.0 - 1e-9);
            ll += y_tr[j]! * Math.log(mu) + (1.0 - y_tr[j]!) * Math.log(1.0 - mu);
          }
          for (let a = 1; a < p_dim; a++) ll -= 0.5 * lam * beta[a]! * beta[a]!;
          if (use_cat) {
            for (const c of catKeys) ll -= 0.5 * lam_cat * alpha_c[c]! * alpha_c[c]!;
          }
          if (Math.abs(ll - prev_ll) < 1e-7) break;
          prev_ll = ll;
      }

      return { beta, alpha_c, feats, use_cat, p0_base };
  }

  function predictLogitNow(
    model: LogitOddsModel,
    rows: SnapshotProtocol[],
    meds: Map<string, number>,
  ): number[] {
      const { beta, alpha_c, feats, use_cat } = model;
      const preds: number[] = [];
      for (const p of rows) {
        const c = p.category || 'Unknown';
        const co = use_cat ? (alpha_c[c] ?? 0.0) : 0.0;
        const x = getLogitVec(p, feats, meds);
        preds.push(sigmoid(dot(x, beta) + co));
      }
      return preds;
  }

  function forwardOddsFromLogit(
    model: LogitOddsModel,
    p: SnapshotProtocol,
    meds: Map<string, number>,
    t90Ref: number,
  ): [number, number, number] {
    const c = p.category || 'Unknown';
    const co = model.use_cat ? (model.alpha_c[c] ?? 0.0) : 0.0;
    const age_y = p.listed_at !== null ? ageDays(asOf, p.listed_at)! / 365.25 : median_age_yr_non_cex;
    const x_now = getLogitVec(p, model.feats, meds, age_y);
    const p_now = sigmoid(dot(x_now, model.beta) + co);

      const t_target = Math.max(t90Ref, age_y + 0.5);
      const x_max = getLogitVec(p, model.feats, meds, t_target);
      const p_max = sigmoid(dot(x_max, model.beta) + co);

      const raw_odds = clip((p_max - p_now) / Math.max(1e-6, 1.0 - p_now), 0.01, 0.95);
      return [raw_odds, p_max, p_now];
  }

  function tuneLogit(
    tune_cohort: SnapshotProtocol[],
    feats: string[],
    use_cat: boolean,
  ): [number, number] {
    const s_rows = tune_cohort.slice().sort((a, b) => {
      if (a.y !== b.y) return a.y! - b.y!;
      const cCat = cmpStr(a.category || '', b.category || '');
      if (cCat !== 0) return cCat;
      const tvlA = a.tvl_usd || 0;
      const tvlB = b.tvl_usd || 0;
      if (tvlA !== tvlB) return tvlA - tvlB;
      return cmpStr(a.slug, b.slug);
    });
    const inner_folds: SnapshotProtocol[][] = Array.from({ length: 5 }, () => [])
      for (let idx = 0; idx < s_rows.length; idx++) {
        inner_folds[idx % 5]!.push(s_rows[idx]!);
      }

      const cat_grid = use_cat ? LOGIT_CAT_LAMBDAS : [1.0];
      const lam_grid = feats.length > 0 ? LOGIT_LAMBDAS : [1.0];

      let best_loss = Infinity;
      let best_lam = lam_grid[0]!;
      let best_lam_cat = cat_grid[0]!;

      for (const lc_val of cat_grid) {
        for (const lam_val of lam_grid) {
          const all_y: number[] = [];
          const all_p: number[] = [];
          for (let k = 0; k < 5; k++) {
            const in_tr: SnapshotProtocol[] = [];
            for (let j = 0; j < 5; j++) {
              if (j !== k) in_tr.push(...inner_folds[j]!);
            }
            const in_val = inner_folds[k]!;
            const in_meds = computeChainMedians(in_tr);
            const model = fitLogit(in_tr, feats, use_cat, lam_val, lc_val, in_meds);
            const preds = predictLogitNow(model, in_val, in_meds);
            for (let i = 0; i < in_val.length; i++) {
              all_y.push(in_val[i]!.y!);
              all_p.push(preds[i]!);
            }
          }
          const avg_loss = logLoss(all_y, all_p);
          if (avg_loss < best_loss) {
            best_loss = avg_loss;
            best_lam = lam_val;
            best_lam_cat = lc_val;
          }
        }
      }
      return [best_lam, best_lam_cat];
  }

  // Zero-Regex 7-term Stage B ablation: [name, feat_to_add, add_cat]
  const stage_b_candidates: [string, string | null, boolean][] = [
    ['1. Base rate of peers (baseline)', null, false],
    ['2. + age, years listed', 'age_yr', false],
    ['3. + category offset (ridge)', null, true],
    ['4. + size, ln(TVL/$100M)', 'tvl_b', false],
    ['5. + 7-day TVL growth', 'x3', false],
    ['6. + chain count, ln(n_chains)', 'chains_b', false],
    ['7. + control: growth of adjacent row', 'ctrl', false],
  ];

  const stage_b_results: any[] = [];
  let kept_b_feats: string[] = [];
  let kept_b_use_cat = false;
  let last_kept_b10 = 0.0;
  let last_kept_bwf = 0.0;

  for (const [name, add_feat, add_cat] of stage_b_candidates) {
    const cand_feats = kept_b_feats.concat(add_feat ? [add_feat] : []);
    const cand_cat = kept_b_use_cat || add_cat;

    if (cand_feats.length === 0 && !cand_cat) {
      const y_t10: number[] = [];
      const y_p10: number[] = [];
      for (let k = 0; k < 10; k++) {
        const tr: SnapshotProtocol[] = [];
        for (let j = 0; j < 10; j++) {
          if (j !== k) tr.push(...folds_10[j]!);
        }
        const te = folds_10[k]!;
        const p0 = tr.reduce((a, b) => a + b.y!, 0) / tr.length;
        for (const p of te) {
          y_t10.push(p.y!);
          y_p10.push(p0);
        }
      }

     const y_twf: number[] = [];
     const y_pwf: number[] = [];
     for (let i = start_wf_b; i < wf_cohort_b.length; i++) {
       const te = wf_cohort_b[i]!;
       const tr = wf_cohort_b.filter((p) => p.listed_at! < te.listed_at!);
       if (tr.length < 35) continue;
       const p0 = tr.reduce((a, b) => a + b.y!, 0) / tr.length;
       y_twf.push(te.y!);
       y_pwf.push(p0);
     }

      const b10 = brierScore(y_t10, y_p10);
      const ac10 = accScore(y_t10, y_p10);
      const bwf = brierScore(y_twf, y_pwf);
      const acwf = accScore(y_twf, y_pwf);
    last_kept_b10 = b10;
    last_kept_bwf = bwf;
    stage_b_results.push({
      name,
      b10,
      ac10,
      bwf,
      acwf,
      status: 'baseline',
      lam_10: 1.0,
      lc_10: 1.0,
      lam_wf: 1.0,
      lc_wf: 1.0,
    });
  } else {
    const [lam_10, lc_10] = tuneLogit(NON_CEX, cand_feats, cand_cat);
    const [lam_wf, lc_wf] = tuneLogit(wf_cohort_b.slice(0, start_wf_b), cand_feats, cand_cat);

   const y_t10: number[] = [];
   const y_p10: number[] = [];
   for (let k = 0; k < 10; k++) {
     const tr: SnapshotProtocol[] = [];
     for (let j = 0; j < 10; j++) {
       if (j !== k) tr.push(...folds_10[j]!);
     }
     const te = folds_10[k]!;
     const tr_meds = computeChainMedians(tr);
     const model = fitLogit(tr, cand_feats, cand_cat, lam_10, lc_10, tr_meds);
     const preds = predictLogitNow(model, te, tr_meds);
     for (let i = 0; i < te.length; i++) {
       y_t10.push(te[i]!.y!);
       y_p10.push(preds[i]!);
     }
   }

    const y_twf: number[] = [];
    const y_pwf: number[] = [];
    for (let i = start_wf_b; i < wf_cohort_b.length; i++) {
      const te = wf_cohort_b[i]!;
      const tr = wf_cohort_b.filter((p) => p.listed_at! < te.listed_at!);
      if (tr.length < 35) continue;
      const tr_meds = computeChainMedians(tr);
      const model_wf = fitLogit(tr, cand_feats, cand_cat, lam_wf, lc_wf, tr_meds);
      const preds = predictLogitNow(model_wf, [te], tr_meds);
      y_twf.push(te.y!);
      y_pwf.push(preds[0]!);
          }

          const b10 = brierScore(y_t10, y_p10);
          const ac10 = accScore(y_t10, y_p10);
          const bwf = brierScore(y_twf, y_pwf);
          const acwf = accScore(y_twf, y_pwf);

          const d10 = last_kept_b10 - b10;
          const dwf = last_kept_bwf - bwf;
          const passes = d10 > 0 && dwf > 0 && (d10 >= 0.001 || dwf >= 0.001);

          let status = '';
          if (name.includes('control')) {
            if (passes) {
              throw new Error('LEAKAGE WARNING: negative control helped');
            }
            status = 'must not help (rejected)';
          } else if (passes) {
            status = 'kept';
            last_kept_b10 = b10;
            last_kept_bwf = bwf;
            kept_b_feats = cand_feats;
            kept_b_use_cat = cand_cat;
          } else {
            status = 'tested, not kept';
          }

          stage_b_results.push({
            name,
            b10,
            ac10,
            bwf,
            acwf,
            status,
            lam_10,
            lc_10,
            lam_wf,
            lc_wf,
          });
      }
  }

  const kept_b_terms: string[] = [];
  for (const r of stage_b_results) {
    if (r.status === 'kept') {
      if (r.name.includes('age')) kept_b_terms.push('age_yr');
             else if (r.name.includes('category')) kept_b_terms.push('category');
             else if (r.name.includes('size')) kept_b_terms.push('tvl_b');
             else if (r.name.includes('growth')) kept_b_terms.push('x3');
             else if (r.name.includes('chain')) kept_b_terms.push('chains_b');
         }
     }

     // Final Fit Stage B
     const [lam_final, lam_cat_final] = tuneLogit(NON_CEX, kept_b_feats, kept_b_use_cat);
     const meds_non_cex = computeChainMedians(NON_CEX);
     const model_b_full = fitLogit(
       NON_CEX,
       kept_b_feats,
       kept_b_use_cat,
       lam_final,
       lam_cat_final,
       meds_non_cex,
     );

  // =====================================================================
  // Board selection & Stage C economics
  // =====================================================================
  const by_slug = new Map<string, SnapshotProtocol>(protocols.map((p) => [p.slug, p]));
  const board_watchlist = watchlist.map((s) => by_slug.get(s)).filter((p): p is SnapshotProtocol => Boolean(p));
  const early_cands = protocols
    .filter((p) => !watchlist.includes(p.slug) && isRankable(p))
    .sort((a, b) => (b.tvl_usd || 0) - (a.tvl_usd || 0) || cmpStr(a.slug, b.slug));
  const board_early = early_cands.slice(0, 160);
  const board_cohort = board_watchlist.concat(board_early);

    const board_odds = new Map<string, [number, number, number, number, number, number, number]>();
    for (const p of board_cohort) {
      const [d1, d2, d3] = computeGates(p);
      const [odds_raw, p_max, p_now] = forwardOddsFromLogit(model_b_full, p, meds_non_cex, t90_yr);
      const p_odds = odds_raw * d1 * d2 * d3;
      // Tuple slots: [p_odds, d1, d2, d3, p_max (as pi), p_now (as F), odds_raw (as odds_raw)]
      board_odds.set(p.slug, [p_odds, d1, d2, d3, p_max, p_now, odds_raw]);
    }

    // 200 Bootstrap Refits
    const rng = new Mulberry32(20261114);
    const boot_betas_a: number[][] = [];
    const boot_betas_b: number[][] = [];
    const boot_cat_offsets = new Map<string, number[]>();
    const board_rank_history = new Map<string, number[]>();
    for (const p of board_cohort) board_rank_history.set(p.slug, []);

    for (let b_idx = 0; b_idx < 200; b_idx++) {
      // 1. Resample L_match (Stage A locked)
      const sample_a = Array.from({ length: N_match }, () => L_match[Math.floor(rng.next() * N_match)]!);
      const meds_boot_a = computeChainMedians(sample_a);
      const X_sa = sample_a.map((p) => [1.0, ...kept_a_feats.map((f) => f === 'x3' ? calcX3(p, meds_boot_a) : p[f])]);
      const y_sa = sample_a.map((p) => p.z!);
      const b_fit_a = huberIrls(X_sa, y_sa);
      boot_betas_a.push(b_fit_a);
      const resids_ba = sample_a.map((p, i) => y_sa[i]! - dot(X_sa[i]!, b_fit_a));
      const med_r_boot = median(resids_ba);

      // 2. Resample NON_CEX (Stage B Zero-Regex Logistic)
      const sample_b = Array.from({ length: N_b }, () => NON_CEX[Math.floor(rng.next() * N_b)]!);
      const meds_boot_b = computeChainMedians(sample_b);
      const t90_boot = quantileSorted(sample_b.map((p) => p.age_yr!).sort((a, b) => a - b), 0.90);
      const model_boot_b = fitLogit(
        sample_b,
        kept_b_feats,
        kept_b_use_cat,
        lam_final,
        lam_cat_final,
        meds_boot_b,
      );
      boot_betas_b.push(model_boot_b.beta);

      for (const [c, off] of Object.entries(model_boot_b.alpha_c)) {
        let l = boot_cat_offsets.get(c);
        if (!l) {
          l = [];
          boot_cat_offsets.set(c, l);
        }
        l.push(off);
      }

      // 3. Repredict board and rerank
      const scored: [number, string][] = [];
      for (const p of board_cohort) {
        const tvl = p.tvl_usd;
        const x_tvl = Math.log(tvl / 1e8);
        const f_a = kept_a_feats.map((f) => f === 'x3' ? calcX3(p, meds_boot_a) : (f === 'x_tvl' ? x_tvl : p[f]));
        const zh = b_fit_a[0]! + dot(b_fit_a.slice(1), f_a);
        const v50_b = tvl * Math.exp(zh + med_r_boot);

          const [d1, d2, d3] = computeGates(p);
          const [raw_b] = forwardOddsFromLogit(model_boot_b, p, meds_boot_b, t90_boot);
          const p_odds_b = raw_b * d1 * d2 * d3;
          const imp_b = Math.max(1, roundJs(p_odds_b * v50_b));
          scored.push([imp_b, p.slug]);
      }

      scored.sort((a, b) => b[0] - a[0] || cmpStr(a[1], b[1]));
      for (let rank_pos = 1; rank_pos <= scored.length; rank_pos++) {
        const slug = scored[rank_pos - 1]![1];
        board_rank_history.get(slug)!.push(rank_pos);
      }
  }

  // SEs
  const boot_se_a: Record<string, number> = {};
  const param_names_a = ['beta0', ...kept_a_feats.map((f) => `beta_${f}`)];
     for (let j = 0; j < param_names_a.length; j++) {
       const vals = boot_betas_a.map((b) => b[j]!);
       const mean_v = vals.reduce((a, b) => a + b, 0.0) / vals.length;
       const se = Math.sqrt(vals.reduce((a, b) => a + (b - mean_v) ** 2, 0.0) / (vals.length - 1));
       boot_se_a[param_names_a[j]!] = se;
     }

     const boot_se_b: Record<string, number> = {};
     const param_names_b = ['beta0', ...kept_b_feats.map((f) => `beta_${f}`)];
     for (let j = 0; j < param_names_b.length; j++) {
       const vals = boot_betas_b.map((b) => b[j]!);
       const mean_v = vals.reduce((a, b) => a + b, 0.0) / vals.length;
       const se = Math.sqrt(vals.reduce((a, b) => a + (b - mean_v) ** 2, 0.0) / (vals.length - 1));
       boot_se_b[param_names_b[j]!] = se;
     }

     const cat_spread: Record<string, { min: number; max: number; mean: number }> = {};
     for (const [c, vals] of boot_cat_offsets.entries()) {
       cat_spread[c] = {
          min: Math.min(...vals),
          max: Math.max(...vals),
          mean: vals.reduce((a, b) => a + b, 0.0) / vals.length,
       };
     }

  const board_rank_ranges = new Map<string, [number, number]>();
  for (const p of board_cohort) {
    const s = board_rank_history.get(p.slug)!.slice().sort((a, b) => a - b);
    const r10 = roundJs(quantileSorted(s, 0.10));
    const r90 = roundJs(quantileSorted(s, 0.90));
    board_rank_ranges.set(p.slug, [r10, r90]);
  }

  // Stage C
  const all_7d = protocols
    .filter((p) => p.change_7d !== null && p.change_7d !== undefined)
    .map((p) => p.change_7d!)
    .sort((a, b) => a - b);
  const p5_7d = quantileSorted(all_7d, 0.05);

  const drop_share_default = 0.07;
  const horizon_wk_default = 12;

  // Comps pool (n=119) with oof_pred
  const oofMap = new Map<string, number>(oof_a.map((o) => [o.slug, o.oof_pred]));
  const cpPool: CompPoolEntry[] = [];
  for (const p of protocols) {
    const mcap = p.mcap_usd ?? 0;
    const tvl = p.tvl_usd ?? 0;
    const cat = p.category;
    if (mcap > 0 && tvl >= 1e6 && cat !== 'CEX') {
      let oof_pred: number;
      if (oofMap.has(p.slug)) {
        oof_pred = oofMap.get(p.slug)!;
      } else {
        const x_tvl = Math.log(tvl / 1e8);
        const f_a = kept_a_feats.map((f) => (f === 'x3' ? calcX3(p, meds_match) : (f === 'x_tvl' ? x_tvl : (p as any)[f])));
        const zh = beta_a_full[0]! + dot(beta_a_full.slice(1), f_a);
        oof_pred = tvl * Math.exp(zh + med_r_loo);
      }
      cpPool.push({
        slug: p.slug,
        name: p.name,
        symbol: p.symbol ?? null,
        category: cat,
        macro_group: macroGroup(cat),
        chains: p.chains ?? [],
        tvl_usd: tvl,
        mcap_usd: mcap,
        g7d: p.change_7d !== null && p.change_7d !== undefined ? roundJs(p.change_7d * 100) / 100 : null,
        oof_pred,
      });
    }
  }
  cpPool.sort((a, b) => b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));

  const raw_board: any[] = [];
  for (const p of board_cohort) {
    const slug = p.slug;
    const tvl = p.tvl_usd;
    const x_tvl = Math.log(tvl / 1e8);
    const f_a = kept_a_feats.map((f) => f === 'x3' ? calcX3(p, meds_match) : (f === 'x_tvl' ? x_tvl : p[f]));
    const zh = beta_a_full[0]! + dot(beta_a_full.slice(1), f_a);

    const v50 = tvl * Math.exp(zh + med_r_loo);
    const v10 = tvl * Math.exp(zh + q10_loo);
    const v25 = tvl * Math.exp(zh + q25_loo);
    const v75 = tvl * Math.exp(zh + q75_loo);
    const v90 = tvl * Math.exp(zh + q90_loo);

    const [p_odds, d1, d2, d3, pi_val, F_val, S_val] = board_odds.get(slug)!;
    const implied = Math.max(1, roundJs(p_odds * v50));
    const implied_p25 = Math.max(1, roundJs(p_odds * v25));
    const implied_p75 = Math.max(1, roundJs(p_odds * v75));

    const deposit = clip(round250(0.0002 * tvl), 1000.0, 10000.0);
    const drop = implied * drop_share_default * deposit / (tvl + deposit);

    const [setup_min, weekly_min, base_tx] = blueprint(p.category);
    const hands_on_hours = (setup_min + weekly_min * horizon_wk_default) / 60.0;
    const tx_count = base_tx + horizon_wk_default;
    const [exec_ch, gas, bridge] = getCheapestChain(p, tx_count);
    const withdraw_fee = 1.00;
    const fees = withdraw_fee + bridge + tx_count * gas;

    const net = drop - fees;
    const net_hr = net / hands_on_hours;
    const tbill = deposit * 0.04 * horizon_wk_default / 52.0;

    const be_drop_share = fees / Math.max(1e-6, implied * deposit / (tvl + deposit));
    const be_token_odds = fees / Math.max(1e-6, v50 * drop_share_default * deposit / (tvl + deposit));
    const exit_tvl = tvl * (1.0 + p5_7d / 100.0);

    const [rank_lo, rank_hi] = board_rank_ranges.get(slug)!;
    const gate_code = gateCodeOf(d1, d2, d3);

    raw_board.push({
      slug,
      name: p.name,
      category: p.category,
      chains: p.chains || [],
      tvl_usd: tvl,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: ageDays(asOf, p.listed_at),
      implied_value_usd: implied,
      implied_p25_usd: implied_p25,
      implied_p75_usd: implied_p75,
      is_watchlist: watchlist.includes(slug),
      zh,
      v50, v10, v25, v75, v90,
      p_odds, pi: pi_val, F: F_val, S: S_val,
      deposit, drop, fees, net, net_hr, tbill,
      hands_on_hours, tx_count,
      be_drop_share, be_token_odds,
      exit_tvl, exec_chain: exec_ch, gas, bridge,
      gate_code, d_gates: [d1, d2, d3],
      rank_lo, rank_hi,
    });
  }

  raw_board.sort((a, b) => b.implied_value_usd - a.implied_value_usd || cmpStr(a.slug, b.slug));
  for (let i = 0; i < raw_board.length; i++) {
    raw_board[i].rank = i + 1;
  }

  const verdict_counts = { farm: 0, marginal: 0, skip: 0 };
  for (const r of raw_board) {
    if (r.p_odds < 0.25 || r.net <= 0.0) {
      r.verdict = 'skip';
    } else if (r.p_odds >= 0.45 && r.net > r.tbill && r.net_hr >= 25.0) {
      r.verdict = 'farm';
    } else {
      r.verdict = 'marginal';
    }
    verdict_counts[r.verdict as keyof typeof verdict_counts]++;
  }

  let farm_count_at_1_25h = 0;
  for (const r of raw_board) {
    const net_hr_125 = r.net / 1.25;
    if (r.p_odds >= 0.45 && r.net > r.tbill && net_hr_125 >= 25.0) {
      farm_count_at_1_25h++;
    }
  }

  // Protocol Accounting Ledger (10 groups)
  const L_match_slugs = new Set(L_match.map((p) => p.slug));
  const board_slugs = new Set(raw_board.map((r) => r.slug));
  const below_cutoff_slugs = new Set(early_cands.slice(160).map((p) => p.slug));
  const wl_set = new Set(watchlist);

  const ledger_groups: [string, string[]][] = [
    ['Ranked · watchlist 40', []],
    ['Ranked · structural gate', []],
    ['Ranked · early (<$50M)', []],
    ['Token trades · priced comp', []],
    ['Token recorded · no usable cap', []],
    ['Out · CEX', []],
    ['Out · bridge/canonical', []],
    ['Out · liquid staking/restaking', []],
    ['Out · versioned', []],
    ['Below board cutoff', []],
  ];
  const ledger_map = new Map<string, string[]>(ledger_groups);

  for (const p of protocols) {
    const s = p.slug;
    const cat = p.category || '';
    const name = p.name || '';
    const has_tok = !isPreToken(p);

    if (board_slugs.has(s)) {
      if (wl_set.has(s)) {
        ledger_map.get('Ranked · watchlist 40')!.push(s);
      } else {
        const [d1, d2, d3] = computeGates(p);
        if (d1 < 1.0 || d2 < 1.0 || d3 < 1.0) {
          ledger_map.get('Ranked · structural gate')!.push(s);
        } else {
          ledger_map.get('Ranked · early (<$50M)')!.push(s);
        }
      }
    } else if (below_cutoff_slugs.has(s)) {
      ledger_map.get('Below board cutoff')!.push(s);
    } else if (cat === 'CEX') {
      ledger_map.get('Out · CEX')!.push(s);
    } else if (cat === 'Bridge' || cat === 'Canonical Bridge') {
      ledger_map.get('Out · bridge/canonical')!.push(s);
    } else if (cat === 'Liquid Staking' || cat === 'Liquid Restaking' || cat === 'Restaked BTC') {
      ledger_map.get('Out · liquid staking/restaking')!.push(s);
    } else if (VERSIONED.test(name)) {
      ledger_map.get('Out · versioned')!.push(s);
    } else if (has_tok) {
      if (L_match_slugs.has(s)) {
        ledger_map.get('Token trades · priced comp')!.push(s);
      } else {
        ledger_map.get('Token recorded · no usable cap')!.push(s);
      }
    } else {
      throw new Error(`Unclassified protocol: ${s}`);
    }
  }

  const total_ledger = ledger_groups.reduce((acc, [, list]) => acc + list.length, 0);
  if (total_ledger !== protocols.length) {
    throw new Error(`Assertion failed: total ledger ${total_ledger} != ${protocols.length}`);
  }

    // Sanity Audit (radar-6.0: Risk Curators ranked honestly by implied value, 0 allowed in FARM)
    const farm_slugs = raw_board.filter((r) => r.verdict === 'farm').map((r) => r.slug);
    const rc_board = raw_board.filter((r) => r.category === 'Risk Curators');
    const rc_skip_count = rc_board.filter((r) => r.verdict === 'skip').length;
    const rc_farm_rows = rc_board.filter((r) => r.verdict === 'farm');
    const rc_top50 = rc_board.filter((r) => r.rank <= 50);

    const audit_violations: [string, string, string][] = rc_farm_rows.map((r) => [
      r.slug,
      'Risk Curators',
      'FARM',
    ]);

    // Gates Evaluation (radar-6.0)
    const final_kept_a_loo = res_a.final_loo;
    const final_kept_a_wf = res_a.final_wf;
    const all_slopes_stable = res_a.rows.every(
       (row) => row[4] !== 'kept' || row[3] === null || row[3] >= 1.5,
    );
    const ctrl_a_rejected = res_a.rows.some(
       (row) => row[0].includes('control') && row[4].includes('rejected'),
    );
    const cov_80_wf_pct = cov_80_wf * 100.0;
    const g1_pass =
    final_kept_a_loo < 3.40 &&
    final_kept_a_wf < 2.70 &&
    all_slopes_stable &&
    ctrl_a_rejected &&
    cov_80_wf_pct >= 70.0 &&
    cov_80_wf_pct <= 90.0;
  const g1_detail = `LOO ×${final_kept_a_loo.toFixed(4)} < ×3.40 AND WF ×${final_kept_a_wf.toFixed(4)} < ×2.70 AND slopes stable (${all_slopes_stable}) AND control rejected (${ctrl_a_rejected}) AND WF coverage ${cov_80_wf_pct.toFixed(1)}% in [70%, 90%]`;

  const kept_b_rows = stage_b_results.filter((r) => r.status === 'kept');
  const final_kept_b = kept_b_rows[kept_b_rows.length - 1] ?? stage_b_results[0]!
  const final_kept_b_10f = final_kept_b.b10;
  const final_kept_b_wf = final_kept_b.bwf;
  const baseline_b_wf = stage_b_results[0]!.bwf;
  const wf_margin = baseline_b_wf - final_kept_b_wf;
  const ctrl_b_rejected = stage_b_results.some(
     (row) => row.name.includes('control') && row.status.includes('rejected'),
  );
  const g2_pass =
    final_kept_b_10f < 0.200 &&
    final_kept_b_wf < 0.225 &&
    wf_margin >= 0.060 &&
    ctrl_b_rejected;
  const g2_detail = `10-fold ${final_kept_b_10f.toFixed(4)} < 0.200 AND WF ${final_kept_b_wf.toFixed(4)} < 0.225 AND beats baseline by ${wf_margin.toFixed(4)} >= 0.060 (baseline ${baseline_b_wf.toFixed(4)}) AND control rejected (${ctrl_b_rejected})`;

  const g3_pass = rc_farm_rows.length === 0;
  const g3_detail = `${rc_farm_rows.length} Risk Curators in FARM (need 0); ${rc_skip_count} SKIP; ${rc_top50.length} in Top 50`;

  const farm_econ_pass = raw_board
    .filter((r) => r.verdict === 'farm')
    .every((r) => r.net > r.tbill && r.net_hr >= 25.0);
  const g4_pass =
    farm_slugs.length >= 15 &&
    farm_slugs.length <= 40 &&
    farm_econ_pass &&
    total_ledger === protocols.length;
  const g4_detail = `${farm_slugs.length} clean FARM rows inside [15, 40] AND 100% Net > T-bill & Net/hr >= $25 (${farm_econ_pass}) AND ledger ${total_ledger}/${protocols.length}`;

  const all_gates_pass = g1_pass && g2_pass && g3_pass && g4_pass;

  process.stdout.write('\n' + '='.repeat(70) + '\n');
  process.stdout.write('STEP 0 GATE VERIFICATION SUMMARY (Neon radar-6.0 Zero-Regex L2 Logistic)\n');
  process.stdout.write('='.repeat(70) + '\n');
  process.stdout.write(`[${g1_pass ? 'PASS' : 'FAIL'}] Gate (i) Stage A accuracy & stability: ${g1_detail}\n`);
  process.stdout.write(`[${g2_pass ? 'PASS' : 'FAIL'}] Gate (ii) Stage B calibration: ${g2_detail}\n`);
  process.stdout.write(`[${g3_pass ? 'PASS' : 'FAIL'}] Gate (iii) Zero Curators in FARM: ${g3_detail}\n`);
  process.stdout.write(`[${g4_pass ? 'PASS' : 'FAIL'}] Gate (iv) FARM Economics: ${g4_detail}\n`);
        process.stdout.write('='.repeat(70) + '\n');

        if (!all_gates_pass) {
          process.stderr.write('WARNING: STEP 0 GATES FAILED — inspect metrics above before submitting.\n');
        }

  // Construct BoardRow and RadarRow items
  const boardRows: BoardRow[] = [];
  const radarRows: RadarRow[] = [];

  for (const r of raw_board) {
    const p = by_slug.get(r.slug)!;
    const comps = nearestComps(
      {
        slug: p.slug,
        category: p.category,
        macro_group: macroGroup(p.category),
        chains: p.chains ?? [],
        tvl_usd: p.tvl_usd,
      },
      cpPool,
      8,
    );

    const rowForSteps = {
      ...r,
      roi: {
        deposit: r.deposit,
        drop: r.drop,
        fees: r.fees,
        net: r.net,
        net_hr: r.net_hr,
        exit_tvl: r.exit_tvl,
        exec_chain: r.exec_chain,
        gas: r.gas,
        bridge: r.bridge,
        hands_on_hours: r.hands_on_hours,
      },
    };

    const steps = r.verdict === 'skip'
      ? skipSteps3(rowForSteps, DEFAULT_SCENARIO, p5_7d)
      : farmSteps10(rowForSteps, DEFAULT_SCENARIO, p5_7d);

    const matrix = matrix3x4(
      { implied: r.implied_value_usd, v50: r.v50, tvl: p.tvl_usd, category: p.category, chains: p.chains },
      12,
      p5_7d,
    );

    boardRows.push({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d !== null ? roundJs(r.change_7d * 100) / 100 : null,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      gecko_id: r.gecko_id,
      symbol: r.symbol,
      token_status: 'pre-token',
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      implied_p25_usd: r.implied_p25_usd,
      implied_p75_usd: r.implied_p75_usd,
      is_watchlist: r.is_watchlist,
      verdict: r.verdict,
      model: {
        v50: roundJs(r.v50),
        v10: roundJs(r.v10),
        v25: roundJs(r.v25),
        v75: roundJs(r.v75),
        v90: roundJs(r.v90),
        p_launch: roundJs(r.p_odds * 1e6) / 1e6,
        pi: roundJs(r.pi * 10000) / 10000,
        F: roundJs(r.F * 10000) / 10000,
        S: roundJs(r.S * 10000) / 10000,
        y_hat: roundJs(r.zh * 10000) / 10000,
        med_r: roundJs(med_r_loo * 10000) / 10000,
        age_days: r.age_days,
        gate_code: r.gate_code,
        rank_lo: r.rank_lo,
        rank_hi: r.rank_hi,
      },
      roi: {
        deposit: roundJs(r.deposit * 100) / 100,
        drop: roundJs(r.drop * 100) / 100,
        fees: roundJs(r.fees * 100) / 100,
        net: roundJs(r.net * 100) / 100,
        net_hr: roundJs(r.net_hr * 100) / 100,
        tbill: roundJs(r.tbill * 100) / 100,
        hands_on_hours: roundJs(r.hands_on_hours * 100) / 100,
        tx_count: r.tx_count,
        be_drop_share: roundJs(r.be_drop_share * 10000) / 10000,
        be_token_odds: roundJs(r.be_token_odds * 10000) / 10000,
        exit_tvl: roundJs(r.exit_tvl * 100) / 100,
        exec_chain: r.exec_chain,
        gas: r.gas,
        bridge: r.bridge,
      },
      farm_steps: steps.map((s) => `${s.role}: ${s.text} (Cost: $${s.cost_usd.toFixed(2)} | Time: ${s.time_min} min)`),
      nearest_comps: comps,
      matrix,
    });

    radarRows.push({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d !== null ? roundJs(r.change_7d * 100) / 100 : null,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      implied_p25_usd: r.implied_p25_usd,
      implied_p75_usd: r.implied_p75_usd,
      v50_usd: roundJs(r.v50),
      v10_usd: roundJs(r.v10),
      v25_usd: roundJs(r.v25),
      v75_usd: roundJs(r.v75),
      v90_usd: roundJs(r.v90),
      p_launch: roundJs(r.p_odds * 1e6) / 1e6,
      pi: roundJs(r.pi * 10000) / 10000,
      F: roundJs(r.F * 10000) / 10000,
      S: roundJs(r.S * 10000) / 10000,
      verdict: r.verdict,
      is_watchlist: r.is_watchlist,
      gate_code: r.gate_code,
      rank_lo: r.rank_lo,
      rank_hi: r.rank_hi,
      deposit: roundJs(r.deposit * 100) / 100,
      drop: roundJs(r.drop * 100) / 100,
      fees: roundJs(r.fees * 100) / 100,
      net: roundJs(r.net * 100) / 100,
      net_hr: roundJs(r.net_hr * 100) / 100,
      tbill: roundJs(r.tbill * 100) / 100,
      hands_on_hours: roundJs(r.hands_on_hours * 100) / 100,
      tx_count: r.tx_count,
      be_drop_share: roundJs(r.be_drop_share * 10000) / 10000,
      be_token_odds: roundJs(r.be_token_odds * 10000) / 10000,
      exit_tvl: roundJs(r.exit_tvl * 100) / 100,
      exec_chain: r.exec_chain,
      comp_idx: comps.map((c) => cpPool.findIndex((cp) => cp.slug === c.slug)),
    });
  }

  const live = liveRows(snapshot);

  const radarData: RadarData = {
    as_of: asOf,
    source: snapshot.source,
    model_version: 'radar-6.0',
    watchlist_size: watchlist.length,
    board_size: raw_board.length,
    early_size: raw_board.filter((r) => !r.is_watchlist).length,
    live_size: live.length,
    calibration_count: N_match,
    p5_7d,
    median_age_yr: median_age_yr_non_cex,
    rows: radarRows,
    live,
    comps_pool: cpPool,
    validation: {
      stage_a: {
        match: {
          n: N_match,
          table: res_a.rows.map((row) => ({
            term: row[0],
            loo_typical_miss: row[1],
            wf_typical_miss: row[2],
            t_stat: row[3],
            status: row[4],
          })),
          kept_feats: res_a.kept_feats,
          kept_offset_group: res_a.kept_offset_group,
          kept_offset_lambdas: res_a.kept_offset_lambdas,
          final_loo: res_a.final_loo,
          final_wf: res_a.final_wf,
          conformal_loo: {
            q10: q10_loo,
            q25: q25_loo,
            med_r: med_r_loo,
            q75: q75_loo,
            q90: q90_loo,
            coverage: {
              within_x3: cov_x3_loo,
              coverage_p25_p75: cov_50_loo,
              coverage_p10_p90: cov_80_loo,
            },
          },
          conformal_wf: {
            q10: q10_wf,
            q25: q25_wf,
            med_r: med_r_wf,
            q75: q75_wf,
            q90: q90_wf,
            coverage: {
              within_x3: cov_x3_wf,
              coverage_p25_p75: cov_50_wf,
              coverage_p10_p90: cov_80_wf,
            },
          },
        },
        all: {
          n: N_all,
          table: res_a_all.rows.map((row) => ({
            term: row[0],
            loo_typical_miss: row[1],
            wf_typical_miss: row[2],
            t_stat: row[3],
            status: row[4],
          })),
        },
        final_fit: {
          beta: beta_a_full,
          beta_se: boot_se_a,
          med_r: med_r_loo,
          q10: q10_loo,
          q25: q25_loo,
          q75: q75_loo,
          q90: q90_loo,
        },
        oof: oof_a,
      },
      stage_b: {
         cohort: 'non_cex',
         n_protocols: N_b,
         ablation: stage_b_results.map((r) => ({
           term: r.name,
           brier_10fold: r.b10,
           acc_10fold: r.ac10,
           brier_wf: r.bwf,
           acc_wf: r.acwf,
           status: r.status,
           cv10_mode_lambda: r.lam_10,
           cv10_mode_lam_cat: r.lc_10,
           wf_lambda: r.lam_wf,
           wf_lam_cat: r.lc_wf,
        })),
         kept_terms: kept_b_terms,
         baseline_wf_brier: baseline_b_wf,
         final_kept_wf_brier: final_kept_b_wf,
         wf_brier_margin: wf_margin,
         final_fit: {
           beta: model_b_full.beta,
           beta_se: boot_se_b,
           alpha_c: model_b_full.alpha_c,
           t90: t90_yr,
           lambda: lam_final,
           lam_cat: lam_cat_final,
           p0_base: model_b_full.p0_base,
        },
         bootstrap: {
           n_refits: 200,
           seed: 20261114,
           se: boot_se_b,
           category_offsets_spread: cat_spread,
        },
      },
      gates: {
        '(i) Stage A accuracy & stability': [g1_pass, g1_detail],
        '(ii) Stage B calibration': [g2_pass, g2_detail],
        '(iii) False Positives': [g3_pass, g3_detail],
        '(iv) FARM Economics': [g4_pass, g4_detail],
      },
      ledger: {
        groups: ledger_groups.map(([name, list]) => [name, list.length]),
        total: total_ledger,
      },
      verdicts: {
        counts: verdict_counts,
        farm_count_at_1_25h,
      },
      audit: {
        rc_skip: rc_skip_count,
        rc_in_top50: rc_top50.length,
        violations: audit_violations,
      },
    },
  };

  return { board: boardRows, radar: radarData };
}

export { buildRadar as buildRadarBase };
