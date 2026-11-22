// lib/model.ts: Token Radar model radar-4.1
// Ported 1:1 from verify-r41.py (Stages A & B).
// Zero hardcoded protocol names or overrides. Fully deterministic.

import {
  aucScore,
  brierScore,
  clip,
  dot,
  huberIrls,
  logLoss,
  maeLog,
  medape,
  median,
  ndcgTop20,
  quantileSorted,
  rmsle,
  roundJs,
  spearman,
} from './stats.ts';

export const MODEL_VERSION = 'radar-4.1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;
export const CALIBRATION_COUNT = 93;

export const LAMBDAS = [0.1, 1, 5, 20];
export const M_SHR_GRID = [5, 10, 20, 50, Infinity];
export const HUBER_DELTA = 1.35;
export const HUBER_ITERS = 15;
export const W0_GRID = [0.0, 0.20, 0.35, 0.50, 0.65, 1.0];
export const TAU_GRID = [365, 600, 900, 1400, 2400];
export const M_GRID = [1, 2, 4];

export const MACRO_GROUPS: Record<string, string[]> = {
  Trading: ['Derivatives', 'Dexs', 'Prediction Market', 'Basis Trading', 'Interest Rate Derivatives'],
  Credit: ['Lending', 'Uncollateralized Lending', 'Yield', 'CDP', 'Dual-Token Stablecoin',
           'Restaking', 'Collateral Markets', 'Leveraged Farming'],
  Vaults: ['Onchain Capital Allocator', 'RWA', 'Yield Aggregator', 'Liquidity Manager',
           'CDP Manager', 'CeDeFi', 'Stablecoin Wrapper', 'Staking Pool', 'Anchor BTC',
           'Decentralized BTC', 'Farm', 'Indexes', 'Insurance', 'Governance Incentives',
           'Risk Curators'],
  Infra: ['Chain', 'Cross Chain Bridge', 'Payments', 'Crypto Card Issuer', 'OTC Marketplace'],
};

export const MACRO_EXT: Record<string, string> = {
  // L_match unmapped (affect the final fit):
  Options: 'Trading',
  DOR: 'Trading',
  'Collateral Management': 'Credit',
  'AI Agents': 'Infra',
  'Decentralized AI': 'Infra',
  Launchpad: 'Infra',
  'NFT Marketplace': 'Infra',
  Privacy: 'Infra',
  'Token Locker': 'Vaults',
  // L_all-only unmapped (audit + board-row offsets):
  Bridge: 'Infra',
  'Canonical Bridge': 'Infra',
  'Liquid Staking': 'Vaults',
  'Liquid Restaking': 'Vaults',
  'Restaked BTC': 'Vaults',
  // Remaining snapshot categories (board rows only):
  'Algo-Stables': 'Credit',
  'Options Vault': 'Trading',
  'Reserve Currency': 'Vaults',
  'Stablecoin Issuer': 'Credit',
  Synthetics: 'Trading',
};

const _CAT2MACRO: Record<string, string> = {};
for (const [g, cs] of Object.entries(MACRO_GROUPS)) {
  for (const c of cs) {
    _CAT2MACRO[c] = g;
  }
}
Object.assign(_CAT2MACRO, MACRO_EXT);

export function macroGroup(cat: string | null): string {
  const g = _CAT2MACRO[cat ?? 'Unknown'];
  if (g === undefined) {
    throw new Error(`unmapped category: ${JSON.stringify(cat)} — add to MACRO_EXT`);
  }
  return g;
}

export const SVC_CATS = new Set([
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

export const NET_CATS = new Set([
  'Payments',
  'Cross Chain Bridge',
  'Staking Pool',
  'Risk Curators',
]);

export const SVC_RE = /\b(?:curator|curation|financial|capital|asset management|gateway|pooling|hub|exchange|prime|by)\b/i;
export const NET_RE = /\bnetwork\b/i;

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

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

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

export function normWord(s: string): string {
  const w = (s.trim().split(/[\s_-]+/)[0] || '').toLowerCase();
  return w.replace(/[^a-z0-9]/g, '');
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !NON_LAUNCH.has(p.category ?? '') && !VERSIONED.test(p.name);
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

// ---------------- Stage A ----------------

export interface BaseCtx {
  bounds: [number, number];
  age_mean: number;
}

export interface AblationRow {
  model: string;
  rmsle: number;
  mae_log: number;
  medape: number;
  spearman_mean_fold: number;
  spearman_pooled: number;
  ndcg20: number;
  delta: number | null;
  delta_mae?: number | null;
  kept: boolean;
  m_shr_per_fold?: Array<string | null> | null;
}

export interface ConformalResult {
  med_r: number;
  q10: number;
  q90: number;
  coverage_pct: number;
  n: number;
}

export class StageA {
  snap: Snapshot;
  asOf: string;
  cohort: 'match' | 'all';
  L: SnapshotProtocol[];
  chainMed: Record<string, number>;
  n_g: Record<string, number>;

  constructor(snap: Snapshot, cohort: 'match' | 'all') {
    this.snap = snap;
    this.asOf = snap.as_of;
    this.cohort = cohort;
    const LAll = snap.protocols.filter(
      (p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd >= 1e6 && p.category !== 'CEX',
    );
    if (cohort === 'match') {
      this.L = LAll.filter(
        (p) => !NON_LAUNCH.has(p.category ?? '') && !VERSIONED.test(p.name),
      );
    } else {
      this.L = LAll;
    }

    const byChain: Record<string, number[]> = {};
    for (const p of snap.protocols) {
      if (p.change_7d !== null) {
        for (const c of p.chains) {
          if (!byChain[c]) byChain[c] = [];
          byChain[c]!.push(p.change_7d);
        }
      }
    }
    this.chainMed = {};
    for (const [c, v] of Object.entries(byChain)) {
      this.chainMed[c] = median(v);
    }

    this.n_g = {};
    for (const p of this.L) {
      const g = macroGroup(p.category);
      this.n_g[g] = (this.n_g[g] ?? 0) + 1;
    }
  }

  folds(items: SnapshotProtocol[]): SnapshotProtocol[][] {
    const s = items.slice().sort((a, b) => {
      const ga = macroGroup(a.category);
      const gb = macroGroup(b.category);
      if (ga < gb) return -1;
      if (ga > gb) return 1;
      if (a.tvl_usd !== b.tvl_usd) return a.tvl_usd - b.tvl_usd;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });
    const f: SnapshotProtocol[][] = [[], [], [], [], []];
    for (let i = 0; i < s.length; i++) {
      f[i % 5]!.push(s[i]!);
    }
    return f;
  }

  x3(p: SnapshotProtocol): number {
    if (p.change_7d === null) return 0.0;
    const meds: number[] = [];
    for (const c of p.chains) {
      if (this.chainMed[c] !== undefined) {
        meds.push(this.chainMed[c]!);
      }
    }
    const gbar = meds.length > 0 ? meds.reduce((a, b) => a + b, 0) / meds.length : 0.0;
    return Math.max(-40.0, Math.min(80.0, p.change_7d - gbar)) / 100.0;
  }

  winsorBounds(train: SnapshotProtocol[]): [number, number] {
    const lr = train.map((p) => Math.log(p.mcap_usd! / p.tvl_usd)).sort((a, b) => a - b);
    return [quantileSorted(lr, 0.05), quantileSorted(lr, 0.95)];
  }

  yWinsor(p: SnapshotProtocol, bounds: [number, number]): number {
    const [q05, q95] = bounds;
    const lr = Math.log(p.mcap_usd! / p.tvl_usd);
    return Math.log(p.tvl_usd) + Math.max(q05, Math.min(q95, lr));
  }

  baseCtx(train: SnapshotProtocol[]): BaseCtx {
    const ages: number[] = [];
    for (const p of train) {
      const a = ageDays(this.asOf, p.listed_at);
      if (a !== null) {
        ages.push(Math.log(1 + a));
      }
    }
    const ageMean = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0.0;
    return {
      bounds: this.winsorBounds(train),
      age_mean: ageMean,
    };
  }

  featVal(p: SnapshotProtocol, ctx: BaseCtx, f: string): number {
    if (f === 'x1') return Math.log(p.tvl_usd);
    if (f === 'x3') return this.x3(p);
    if (f === 'x4') {
      const a = ageDays(this.asOf, p.listed_at);
      return a !== null ? Math.log(1 + a) : ctx.age_mean;
    }
    if (f === 'x5') return Math.log(Math.max(1, p.chains.length));
    throw new Error(`unknown feature ${f}`);
  }

  featVec(p: SnapshotProtocol, ctx: BaseCtx, freeFeats: string[]): number[] {
    return [1.0, ...freeFeats.map((f) => this.featVal(p, ctx, f))];
  }

  fitM1(train: SnapshotProtocol[], ctx: BaseCtx, lam: number): number[] {
    const X = train.map((p) => [1.0, Math.log(p.tvl_usd)]);
    const y = train.map((p) => this.yWinsor(p, ctx.bounds));
    return huberIrls(X, y, lam);
  }

  alphaFromM1(
    train: SnapshotProtocol[],
    ctx: BaseCtx,
    betaM1: number[],
    mShr: number,
  ): Record<string, number> {
    const res: Record<string, number[]> = {};
    for (const p of train) {
      const r = this.yWinsor(p, ctx.bounds) - (betaM1[0]! + betaM1[1]! * Math.log(p.tvl_usd));
      const g = macroGroup(p.category);
      if (!res[g]) res[g] = [];
      res[g]!.push(r);
    }
    const out: Record<string, number> = {};
    for (const [g, v] of Object.entries(res)) {
      const n = v.length;
      const shrink = mShr === Infinity ? 0.0 : n / (n + mShr);
      out[g] = shrink * median(v);
    }
    return out;
  }

  fitOffsetModel(
    train: SnapshotProtocol[],
    ctx: BaseCtx,
    alpha: Record<string, number>,
    freeFeats: string[],
    lam: number,
  ): number[] {
    const X = train.map((p) => this.featVec(p, ctx, freeFeats));
    const y = train.map((p) => this.yWinsor(p, ctx.bounds) - (alpha[macroGroup(p.category)] ?? 0.0));
    return huberIrls(X, y, lam);
  }

  predict(
    p: SnapshotProtocol,
    ctx: BaseCtx,
    alpha: Record<string, number>,
    beta: number[],
    freeFeats: string[],
  ): number {
    return dot(this.featVec(p, ctx, freeFeats), beta) + (alpha[macroGroup(p.category)] ?? 0.0);
  }

  tuneLamM1(train: SnapshotProtocol[]): number {
    const f = this.folds(train);
    let bestLam = LAMBDAS[0]!;
    let bestErr = Infinity;
    for (const lam of LAMBDAS) {
      let se = 0.0;
      let n = 0;
      for (let k = 0; k < 5; k++) {
        const tr: SnapshotProtocol[] = [];
        for (let j = 0; j < 5; j++) {
          if (j !== k) tr.push(...f[j]!);
        }
        const te = f[k]!;
        const ctx = this.baseCtx(tr);
        const beta = this.fitM1(tr, ctx, lam);
        for (const p of te) {
          const yh = beta[0]! + beta[1]! * Math.log(p.tvl_usd);
          se += (yh - Math.log(p.mcap_usd!)) ** 2;
          n++;
        }
      }
      const err = Math.sqrt(se / n);
      if (err < bestErr) {
        bestErr = err;
        bestLam = lam;
      }
    }
    return bestLam;
  }

  tuneOffset(train: SnapshotProtocol[], lamM1: number, freeFeats: string[]): [number, number] {
    const f = this.folds(train);
    const pre: Array<{
      tr: SnapshotProtocol[];
      te: SnapshotProtocol[];
      ctx: BaseCtx;
      alphas: Record<string, Record<string, number>>;
    }> = [];
    for (let k = 0; k < 5; k++) {
      const tr: SnapshotProtocol[] = [];
      for (let j = 0; j < 5; j++) {
        if (j !== k) tr.push(...f[j]!);
      }
      const te = f[k]!;
      const ctx = this.baseCtx(tr);
      const b1 = this.fitM1(tr, ctx, lamM1);
      const alphas: Record<string, Record<string, number>> = {};
      for (const m of M_SHR_GRID) {
        alphas[String(m)] = this.alphaFromM1(tr, ctx, b1, m);
      }
      pre.push({ tr, te, ctx, alphas });
    }
    let best: [number, number] = [LAMBDAS[0]!, M_SHR_GRID[0]!];
    let bestErr = Infinity;
    for (const mShr of M_SHR_GRID) {
      for (const lam of LAMBDAS) {
        let se = 0.0;
        let n = 0;
        for (const item of pre) {
          const alpha = item.alphas[String(mShr)]!;
          const beta = this.fitOffsetModel(item.tr, item.ctx, alpha, freeFeats, lam);
          for (const p of item.te) {
            const yh = this.predict(p, item.ctx, alpha, beta, freeFeats);
            se += (yh - Math.log(p.mcap_usd!)) ** 2;
            n++;
          }
        }
        const err = Math.sqrt(se / n);
        if (err < bestErr) {
          bestErr = err;
          best = [lam, mShr];
        }
      }
    }
    return best;
  }

  tuneLamOffset(train: SnapshotProtocol[], lamM1: number, mShr: number, freeFeats: string[]): number {
    const f = this.folds(train);
    const pre: Array<{
      tr: SnapshotProtocol[];
      te: SnapshotProtocol[];
      ctx: BaseCtx;
      alpha: Record<string, number>;
    }> = [];
    for (let k = 0; k < 5; k++) {
      const tr: SnapshotProtocol[] = [];
      for (let j = 0; j < 5; j++) {
        if (j !== k) tr.push(...f[j]!);
      }
      const te = f[k]!;
      const ctx = this.baseCtx(tr);
      const b1 = this.fitM1(tr, ctx, lamM1);
      const alpha = this.alphaFromM1(tr, ctx, b1, mShr);
      pre.push({ tr, te, ctx, alpha });
    }
    let bestLam = LAMBDAS[0]!;
    let bestErr = Infinity;
    for (const lam of LAMBDAS) {
      let se = 0.0;
      let n = 0;
      for (const item of pre) {
        const beta = this.fitOffsetModel(item.tr, item.ctx, item.alpha, freeFeats, lam);
        for (const p of item.te) {
          const yh = this.predict(p, item.ctx, item.alpha, beta, freeFeats);
          se += (yh - Math.log(p.mcap_usd!)) ** 2;
          n++;
        }
      }
      const err = Math.sqrt(se / n);
      if (err < bestErr) {
        bestErr = err;
        bestLam = lam;
      }
    }
    return bestLam;
  }

  oofFor(
    freeFeats: string[],
    useOffset: boolean,
    mShrPerFold: Array<number | null> | null = null,
  ): [Array<[number, number, string, number]>, Array<number | null>] {
    const f = this.folds(this.L);
    const out: Array<[number, number, string, number]> = [];
    const mshrs: Array<number | null> = [];
    for (let k = 0; k < 5; k++) {
      const train: SnapshotProtocol[] = [];
      for (let j = 0; j < 5; j++) {
        if (j !== k) train.push(...f[j]!);
      }
      const test = f[k]!;
      const ctx = this.baseCtx(train);
      const lamM1 = this.tuneLamM1(train);
      let alpha: Record<string, number> = {};
      let beta: number[] = [];

      if (!useOffset) {
        const lam = this.tuneLamOffset(train, lamM1, Infinity, freeFeats);
        beta = this.fitOffsetModel(train, ctx, {}, freeFeats, lam);
        mshrs.push(null);
      } else if (mShrPerFold === null) {
        const [lam, mShr] = this.tuneOffset(train, lamM1, freeFeats);
        const b1 = this.fitM1(train, ctx, lamM1);
        alpha = this.alphaFromM1(train, ctx, b1, mShr);
        beta = this.fitOffsetModel(train, ctx, alpha, freeFeats, lam);
        mshrs.push(mShr);
      } else {
        const mShr = mShrPerFold[k]!;
        const lam = this.tuneLamOffset(train, lamM1, mShr, freeFeats);
        const b1 = this.fitM1(train, ctx, lamM1);
        alpha = this.alphaFromM1(train, ctx, b1, mShr);
        beta = this.fitOffsetModel(train, ctx, alpha, freeFeats, lam);
        mshrs.push(mShr);
      }

      for (const p of test) {
        const yh = this.predict(p, ctx, alpha, beta, freeFeats);
        out.push([Math.log(p.mcap_usd!), yh, p.slug, k]);
      }
    }
    return [out, mshrs];
  }

  metrics(oof: Array<[number, number, string, number]>): {
    rmsle: number;
    mae_log: number;
    medape: number;
    spearman_mean_fold: number;
    spearman_pooled: number;
    ndcg20: number;
  } {
    const pairs: [number, number][] = oof.map((r) => [r[0], r[1]]);
    const byFold: Record<number, Array<[number, number]>> = {};
    for (const [y, yh, , k] of oof) {
      if (!byFold[k]) byFold[k] = [];
      byFold[k]!.push([y, yh]);
    }
    let foldSpSum = 0.0;
    const foldCount = Object.keys(byFold).length;
    for (const v of Object.values(byFold)) {
      foldSpSum += spearman(
        v.map((p) => p[0]),
        v.map((p) => p[1]),
      );
    }
    const meanSp = foldCount > 0 ? foldSpSum / foldCount : 0.0;
    const actuals = pairs.map((p) => p[0]);
    const preds = pairs.map((p) => p[1]);

    return {
      rmsle: rmsle(pairs),
      mae_log: maeLog(pairs),
      medape: medape(pairs),
      spearman_mean_fold: meanSp,
      spearman_pooled: spearman(actuals, preds),
      ndcg20: ndcgTop20(actuals, preds),
    };
  }

  ablation(): {
    table: AblationRow[];
    kept: [string[], boolean];
    keptMshrs: Array<number | null> | null;
    oofFinal: Array<[number, number, string, number]>;
  } {
    const pairs0: [number, number][] = this.L.map((p) => [
      Math.log(p.mcap_usd!),
      Math.log(0.25 * p.tvl_usd),
    ]);
    const folds0 = this.folds(this.L);
    const byFold0: Record<number, Array<[number, number]>> = {};
    for (let k = 0; k < folds0.length; k++) {
      byFold0[k] = folds0[k]!.map((p) => [
        Math.log(p.mcap_usd!),
        Math.log(0.25 * p.tvl_usd),
      ]);
    }
    let foldSp0 = 0.0;
    for (let k = 0; k < 5; k++) {
      const v = byFold0[k]!;
      foldSp0 += spearman(
        v.map((p) => p[0]),
        v.map((p) => p[1]),
      );
    }
    const actuals0 = pairs0.map((p) => p[0]);
    const preds0 = pairs0.map((p) => p[1]);

    const m0: AblationRow = {
      model: 'M0',
      rmsle: rmsle(pairs0),
      mae_log: maeLog(pairs0),
      medape: medape(pairs0),
      spearman_mean_fold: foldSp0 / 5,
      spearman_pooled: spearman(actuals0, preds0),
      ndcg20: ndcgTop20(actuals0, preds0),
      delta: null,
      kept: true,
    };

    const table: AblationRow[] = [m0];
    let prevR = m0.rmsle;
    let prevM = m0.mae_log;
    let keptFree: string[] = ['x1'];
    let keptOff = false;
    let keptMshrs: Array<number | null> | null = null;
    let oofFinal: Array<[number, number, string, number]> = [];

    const runStage = (
      name: string,
      freeFeats: string[],
      useOffset: boolean,
      mShrPerFold: Array<number | null> | null,
      gated: boolean,
    ): boolean => {
      const [oof, mshrs] = this.oofFor(freeFeats, useOffset, mShrPerFold);
      const mt = this.metrics(oof);
      const dR = prevR - mt.rmsle;
      const dM = prevM - mt.mae_log;
      const keep = !gated ? true : dR >= 0.002 || (dM >= 0.005 && dR >= -0.005);
      table.push({
        model: name,
        ...mt,
        delta: dR,
        delta_mae: dM,
        kept: keep,
        m_shr_per_fold: useOffset
          ? mshrs.map((v) => (v === null ? null : v === Infinity ? 'inf' : String(v)))
          : null,
      });
      if (keep) {
        prevR = mt.rmsle;
        prevM = mt.mae_log;
        keptFree = freeFeats.slice();
        keptOff = useOffset;
        keptMshrs = mshrs;
        oofFinal = oof;
      }
      return keep;
    };

    runStage('M1', ['x1'], false, null, false);
    runStage('M2', ['x1'], true, null, true);
    runStage('M3', [...keptFree, 'x3'], keptOff, keptMshrs, true);
    runStage('M4', [...keptFree, 'x4'], keptOff, keptMshrs, true);
    runStage('M5', [...keptFree, 'x5'], keptOff, keptMshrs, true);

    return {
      table,
      kept: [keptFree, keptOff],
      keptMshrs,
      oofFinal,
    };
  }

  conformal(oofFinal: Array<[number, number, string, number]>): ConformalResult {
    const bySlug = new Map<string, SnapshotProtocol>(this.L.map((p) => [p.slug, p]));
    const res: Array<[number, number, number]> = [];
    for (const [y, yh, slug] of oofFinal) {
      const p = bySlug.get(slug)!;
      const s = Math.sqrt(1 + 1 / (this.n_g[macroGroup(p.category)]! + 3));
      res.push([y, yh, s]);
    }
    const medR = median(res.map((r) => r[0] - r[1]));
    const u = res.map((r) => (r[0] - r[1]) / r[2]).sort((a, b) => a - b);
    const N = u.length;
    const q10 = u[Math.max(0, Math.floor(0.10 * (N + 1)) - 1)]!;
    const q90 = u[Math.min(N - 1, Math.ceil(0.90 * (N + 1)) - 1)]!;

    let inside = 0;
    for (let i = 0; i < res.length; i++) {
      const uLoo: number[] = [];
      for (let j = 0; j < res.length; j++) {
        if (j !== i) {
          const r = res[j]!;
          uLoo.push((r[0] - r[1]) / r[2]);
        }
      }
      uLoo.sort((a, b) => a - b);
      const n2 = uLoo.length;
      const q10l = uLoo[Math.max(0, Math.floor(0.10 * (n2 + 1)) - 1)]!;
      const q90l = uLoo[Math.min(n2 - 1, Math.ceil(0.90 * (n2 + 1)) - 1)]!;
      const [y, yh, s] = res[i]!;
      if (yh + s * q10l <= y && y <= yh + s * q90l) {
        inside++;
      }
    }

    return {
      med_r: medR,
      q10,
      q90,
      coverage_pct: (100.0 * inside) / N,
      n: N,
    };
  }

  finalModel(
    kept: [string[], boolean],
    _keptMshrs: Array<number | null> | null,
  ): {
    ctx: BaseCtx;
    alpha: Record<string, number>;
    beta: number[];
    lam: number;
    m_shr: number | null;
    lam_m1: number;
  } {
    const [freeFeats, useOffset] = kept;
    const ctx = this.baseCtx(this.L);
    const lamM1 = this.tuneLamM1(this.L);
    if (!useOffset) {
      const lam = this.tuneLamOffset(this.L, lamM1, Infinity, freeFeats);
      const beta = this.fitOffsetModel(this.L, ctx, {}, freeFeats, lam);
      return { ctx, alpha: {}, beta, lam, m_shr: null, lam_m1: lamM1 };
    }
    const [lam, mShr] = this.tuneOffset(this.L, lamM1, freeFeats);
    const b1 = this.fitM1(this.L, ctx, lamM1);
    const alpha = this.alphaFromM1(this.L, ctx, b1, mShr);
    const beta = this.fitOffsetModel(this.L, ctx, alpha, freeFeats, lam);
    return { ctx, alpha, beta, lam, m_shr: mShr, lam_m1: lamM1 };
  }
}

// ---------------- Stage B ----------------

export interface CureFitResult {
  logloss: number;
  w0: number;
  tau: number;
  m: number;
  p0_asym: number;
  pi_asym: Record<string, number>;
  med_age: number;
}

export interface StageBCvResult {
  b0: { auc: number; brier: number };
  b1: { auc: number; brier: number };
  b2: { auc: number; brier: number };
  b3: { auc: number; brier: number; base: string };
  final: {
    auc: number;
    brier: number;
    keep_F: boolean;
    keep_dsvc: boolean;
    bss: number;
  };
  fold_params: Array<{
    m_b1: number;
    w0: number;
    tau: number;
    m_cure: number;
    d_svc: number;
  }>;
}

export class StageB {
  snap: Snapshot;
  asOf: string;
  non_cex: SnapshotProtocol[];
  p0: number;
  liveBrands: Set<string>;
  liveEcoChains: Set<string>;
  keep_F: boolean = false;
  keep_dsvc: boolean = false;
  m_b1: number = 1;
  p0_full: number = 0.5;
  pi_full: Record<string, number> = {};
  cure_full!: CureFitResult;
  dsvc_full: number = 1.0;
  dsvc_stats: [number, number, number] = [0, 0, 0];

  constructor(snap: Snapshot) {
    this.snap = snap;
    this.asOf = snap.as_of;
    this.non_cex = snap.protocols.filter((p) => p.category !== 'CEX');
    let nonPre = 0;
    for (const p of this.non_cex) {
      if (!isPreToken(p)) nonPre++;
    }
    this.p0 = nonPre / this.non_cex.length;

    this.liveBrands = new Set<string>();
    for (const p of snap.protocols) {
      if (!isPreToken(p)) {
        const fw = normWord(p.name);
        if (fw.length >= 4) this.liveBrands.add(fw);
        if (p.symbol) {
          const sw = normWord(p.symbol);
          if (sw.length >= 4) this.liveBrands.add(sw);
        }
      }
    }

    this.liveEcoChains = new Set<string>();
    for (const p of snap.protocols) {
      if (!isPreToken(p)) {
        for (const ch of p.chains) {
          this.liveEcoChains.add(ch);
        }
      }
    }
  }

  y(p: SnapshotProtocol): number {
    return !isPreToken(p) ? 1 : 0;
  }

  targetName(): string {
    return '!isPreToken';
  }

  isService(p: SnapshotProtocol): boolean {
    const cat = p.category ?? '';
    const name = p.name ?? '';
    if (SVC_CATS.has(cat) && SVC_RE.test(name)) return true;
    if (NET_CATS.has(cat) && NET_RE.test(name)) return true;
    return false;
  }

  dServiceFit(train: SnapshotProtocol[]): [number, [number, number, number]] {
    const svc = train.filter((p) => this.isService(p));
    let k = 0;
    for (const p of svc) {
      k += this.y(p);
    }
    const n = svc.length;
    let sumY = 0;
    for (const p of train) {
      sumY += this.y(p);
    }
    const p0 = sumY / train.length;
    const d = p0 > 0 ? clip(((k + 0.5) / (n + 2)) / p0, 0.05, 0.45) : 0.45;
    return [d, [k, n, p0]];
  }

  cureFit(train: SnapshotProtocol[]): CureFitResult {
    const ages: number[] = [];
    for (const p of train) {
      if (p.listed_at !== null) {
        const a = ageDays(this.asOf, p.listed_at);
        if (a !== null) ages.push(a);
      }
    }
    const medAge = ages.length > 0 ? median(ages) : 365.0;
    const ys = train.map((p) => this.y(p));
    const ts = train.map((p) => {
      const a = ageDays(this.asOf, p.listed_at);
      return a !== null ? a : medAge;
    });
    const cats = train.map((p) => p.category ?? 'Unknown');

    let best: {
      ll: number;
      w0: number;
      tau: number;
      m: number;
      p0_asym: number;
      pi_asym: Record<string, number>;
    } | null = null;

    for (const w0 of W0_GRID) {
      for (const tau of TAU_GRID) {
        const F = ts.map((t) => 1 - (1 - w0) * Math.exp(-t / tau));
        let sumF = 0.0;
        let sumY = 0.0;
        for (let i = 0; i < F.length; i++) {
          sumF += F[i]!;
          sumY += ys[i]!;
        }
        const p0Asym = sumF > 0 ? clip(sumY / sumF, 0.05, 0.95) : 0.5;

        const kC: Record<string, number> = {};
        const sFC: Record<string, number> = {};
        for (let i = 0; i < cats.length; i++) {
          const c = cats[i]!;
          kC[c] = (kC[c] ?? 0) + ys[i]!;
          sFC[c] = (sFC[c] ?? 0) + F[i]!;
        }

        const uniqueCats = Object.keys(kC);
        for (const m of M_GRID) {
          const pi: Record<string, number> = {};
          for (const c of uniqueCats) {
            pi[c] = clip((kC[c]! + m * p0Asym) / (sFC[c]! + m), 0.01, 0.95);
          }

          let ll = 0.0;
          for (let i = 0; i < train.length; i++) {
            const c = cats[i]!;
            const y = ys[i]!;
            const f = F[i]!;
            const ph = clip(pi[c]! * f, 1e-6, 1 - 1e-6);
            ll += -(y * Math.log(ph) + (1 - y) * Math.log(1 - ph));
          }
          ll /= train.length;

          if (best === null || ll < best.ll - 1e-12) {
            best = { ll, w0, tau, m, p0_asym: p0Asym, pi_asym: pi };
          }
        }
      }
    }

    return {
      logloss: best!.ll,
      w0: best!.w0,
      tau: best!.tau,
      m: best!.m,
      p0_asym: best!.p0_asym,
      pi_asym: best!.pi_asym,
      med_age: medAge,
    };
  }

  piFit(train: SnapshotProtocol[], m: number): [number, Record<string, number>] {
    let sumY = 0;
    const kC: Record<string, number> = {};
    const nC: Record<string, number> = {};
    for (const p of train) {
      const y = this.y(p);
      sumY += y;
      const c = p.category ?? 'Unknown';
      kC[c] = (kC[c] ?? 0) + y;
      nC[c] = (nC[c] ?? 0) + 1;
    }
    const p0 = sumY / train.length;
    const pi: Record<string, number> = {};
    for (const [c, n] of Object.entries(nC)) {
      pi[c] = (kC[c]! + m * p0) / (n + m);
    }
    return [p0, pi];
  }

  tuneMInner(train: SnapshotProtocol[]): number {
    const rows = train.slice().sort((a, b) => {
      const ca = a.category ?? 'Unknown';
      const cb = b.category ?? 'Unknown';
      if (ca < cb) return -1;
      if (ca > cb) return 1;
      if (a.tvl_usd !== b.tvl_usd) return a.tvl_usd - b.tvl_usd;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });

    const folds: SnapshotProtocol[][] = [[], [], [], [], []];
    for (let i = 0; i < rows.length; i++) {
      folds[i % 5]!.push(rows[i]!);
    }

    let bestM = M_GRID[0]!;
    let bestLl = Infinity;

    for (const m of M_GRID) {
      const labels: number[] = [];
      const scores: number[] = [];
      for (let k = 0; k < 5; k++) {
        const tr: SnapshotProtocol[] = [];
        for (let j = 0; j < 5; j++) {
          if (j !== k) tr.push(...folds[j]!);
        }
        const te = folds[k]!;
        const [p0, pi] = this.piFit(tr, m);
        for (const p of te) {
          labels.push(this.y(p));
          scores.push(pi[p.category ?? 'Unknown'] ?? p0);
        }
      }
      const ll = logLoss(labels, scores);
      if (ll < bestLl) {
        bestLl = ll;
        bestM = m;
      }
    }
    return bestM;
  }

  gates(p: SnapshotProtocol): [number, number, number] {
    const fw = normWord(p.name);
    const isPegged = (
      p.category === 'CDP' &&
      /^usd[a-z0-9]{1,2}$/i.test(p.name.trim()) &&
      p.tvl_usd > 500_000_000
    );
    const dParent = ((fw.length >= 4 && this.liveBrands.has(fw)) || isPegged) ? 0.05 : 1.0;

    let chainMatch = false;
    for (const ch of p.chains) {
      const cw = normWord(ch);
      if (cw.length >= 4 && fw.length >= 4 && (cw === fw || fw.startsWith(cw) || cw.startsWith(fw))) {
        chainMatch = true;
        break;
      }
    }
    const dChainSub = (p.category === 'Chain' && p.chains.length > 0 && !chainMatch) ? 0.15 : 1.0;

    let dNative = 1.0;
    if (p.category !== 'Chain') {
      for (const ch of p.chains) {
        const cw = normWord(ch);
        if (cw.length >= 4 && fw.length >= 4 && cw === fw && this.liveEcoChains.has(ch)) {
          dNative = 0.10;
          break;
        }
      }
    }
    return [dParent, dChainSub, dNative];
  }

  cv(): StageBCvResult {
    const rows = this.non_cex.slice().sort((a, b) => {
      const ca = a.category ?? 'Unknown';
      const cb = b.category ?? 'Unknown';
      if (ca < cb) return -1;
      if (ca > cb) return 1;
      if (a.tvl_usd !== b.tvl_usd) return a.tvl_usd - b.tvl_usd;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });

    const folds: SnapshotProtocol[][] = [[], [], [], [], []];
    for (let i = 0; i < rows.length; i++) {
      folds[i % 5]!.push(rows[i]!);
    }

    const labels: number[] = [];
    const s0: number[] = [];
    const s1: number[] = [];
    const s2: number[] = [];
    const dsvcRow: number[] = [];
    const foldParams: Array<{
      m_b1: number;
      w0: number;
      tau: number;
      m_cure: number;
      d_svc: number;
    }> = [];

    for (let k = 0; k < 5; k++) {
      const train: SnapshotProtocol[] = [];
      for (let j = 0; j < 5; j++) {
        if (j !== k) train.push(...folds[j]!);
      }
      const test = folds[k]!;
      const m1 = this.tuneMInner(train);
      const [p0Tr, piTr] = this.piFit(train, m1);
      const cure = this.cureFit(train);
      const [dsvc] = this.dServiceFit(train);
      foldParams.push({
        m_b1: m1,
        w0: cure.w0,
        tau: cure.tau,
        m_cure: cure.m,
        d_svc: dsvc,
      });

      for (const p of test) {
        const c = p.category ?? 'Unknown';
        labels.push(this.y(p));
        s0.push(p0Tr);
        s1.push(piTr[c] ?? p0Tr);
        const a = ageDays(this.asOf, p.listed_at);
        const t = a !== null ? a : cure.med_age;
        const F = 1 - (1 - cure.w0) * Math.exp(-t / cure.tau);
        s2.push((cure.pi_asym[c] ?? cure.p0_asym) * F);
        dsvcRow.push(this.isService(p) ? dsvc : 1.0);
      }
    }

    const b0 = { auc: aucScore(labels, s0), brier: brierScore(labels, s0) };
    const b1 = { auc: aucScore(labels, s1), brier: brierScore(labels, s1) };
    const b2 = { auc: aucScore(labels, s2), brier: brierScore(labels, s2) };

    const keepF = b2.brier <= b1.brier + 0.002 && b2.auc > b1.auc;
    const best = keepF ? s2 : s1;
    const bestKey = keepF ? 'b2' : 'b1';

    const s3 = best.map((b, i) => b * dsvcRow[i]!);
    const b3 = {
      auc: aucScore(labels, s3),
      brier: brierScore(labels, s3),
      base: bestKey,
    };

    const keepDsvc = b3.brier <= (keepF ? b2.brier : b1.brier) && b3.auc >= (keepF ? b2.auc : b1.auc);
    const finalScores = keepDsvc ? s3 : best;

    return {
      b0,
      b1,
      b2,
      b3,
      final: {
        auc: aucScore(labels, finalScores),
        brier: brierScore(labels, finalScores),
        keep_F: keepF,
        keep_dsvc: keepDsvc,
        bss: 1 - brierScore(labels, finalScores) / b0.brier,
      },
      fold_params: foldParams,
    };
  }

  finalFit(keepF: boolean, keepDsvc: boolean): void {
    this.keep_F = keepF;
    this.keep_dsvc = keepDsvc;
    this.m_b1 = this.tuneMInner(this.non_cex);
    const [p0, pi] = this.piFit(this.non_cex, this.m_b1);
    this.p0_full = p0;
    this.pi_full = pi;
    this.cure_full = this.cureFit(this.non_cex);
    const [dsvc, stats] = this.dServiceFit(this.non_cex);
    this.dsvc_full = dsvc;
    this.dsvc_stats = stats;
  }

  pBase(p: SnapshotProtocol): number {
    const c = p.category ?? 'Unknown';
    if (this.keep_F) {
      const pi = this.cure_full.pi_asym[c] ?? this.cure_full.p0_asym;
      const a = ageDays(this.asOf, p.listed_at);
      const S = a === null ? 0.70 : Math.max(0.15, Math.exp(-a / this.cure_full.tau));
      return (pi * S) / (pi * S + (1 - pi));
    }
    const pi = this.pi_full[c] ?? this.p0_full;
    const a = ageDays(this.asOf, p.listed_at);
    return pi * (a !== null && a > 1095 ? 0.65 : 1.0);
  }

  pLaunch(p: SnapshotProtocol): number {
    const pb = this.pBase(p);
    const d = this.keep_dsvc && this.isService(p) ? this.dsvc_full : 1.0;
    const [d1, d2, d3] = this.gates(p);
    return clip(pb * d * d1 * d2 * d3, 0.0, 0.95);
  }
}

// ---------------- Board, Radar & Farm Machinery ----------------

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

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  verdict: 'farm' | 'watch' | 'skip';
  model: {
    v50: number;
    v10: number;
    v90: number;
    p_launch: number;
    y_hat: number;
    alpha_group: number;
    med_r: number;
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
  v50_usd: number;
  v10_usd: number;
  v90_usd: number;
  p_launch: number;
  verdict: 'farm' | 'watch' | 'skip';
  is_watchlist: boolean;
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
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration_count: number;
  rows: RadarRow[];
  live: LiveRow[];
  validation: {
    stage_a: {
      match: {
        n: number;
        table: AblationRow[];
        kept_free: string[];
        kept_offset: boolean;
        conformal: ConformalResult;
      };
      all: {
        n: number;
        table: AblationRow[];
        conformal: ConformalResult;
      };
      final_fit: {
        lambda: number;
        m_shr: string | null;
        lam_m1: number;
        beta: number[];
        alpha: Record<string, number>;
        winsor_bounds: number[];
        n_g: Record<string, number>;
      };
    };
    stage_b: {
      target: string;
      p0: number;
      cv: StageBCvResult;
      keep_F: boolean;
      keep_dsvc: boolean;
      m_b1: number;
      p0_full: number;
      cure: {
        w0: number;
        tau: number;
        m: number;
        p0_asym: number;
      };
      d_service: number;
      d_service_stats: number[];
    };
    verdicts: {
      q70_p: number;
      p_floor: number;
      q75_implied: number;
      counts: Record<string, number>;
    };
    oof_scatter: Array<{ slug: string; actual_ln: number; pred_ln: number }>;
  };
}

export const round2 = (n: number | null): number | null => (n !== null ? Number(n.toFixed(2)) : null);

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
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

export function buildRadar(snapshot: Snapshot): {
  board: BoardRow[];
  radar: RadarData;
} {
  // Stage A ablations on both cohorts
  const aMatch = new StageA(snapshot, 'match');
  const resMatch = aMatch.ablation();
  const confMatch = aMatch.conformal(resMatch.oofFinal);

  const aAll = new StageA(snapshot, 'all');
  const resAll = aAll.ablation();
  const confAll = aAll.conformal(resAll.oofFinal);

  // Final Stage A fit on L_match
  const finalFitA = aMatch.finalModel(resMatch.kept, resMatch.keptMshrs);

  // Stage B CV and final fit
  const b = new StageB(snapshot);
  const cvB = b.cv();
  b.finalFit(cvB.final.keep_F, cvB.final.keep_dsvc);

  // Board selection: 40 watchlist + top 160 rankable
  const bySlug = new Map<string, SnapshotProtocol>(snapshot.protocols.map((p) => [p.slug, p]));
  const chosenMap = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosenMap.set(slug, p);
  }

  const early = snapshot.protocols
    .filter((p) => !chosenMap.has(p.slug) && isRankable(p))
    .sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosenMap.set(p.slug, p);

  // Predict each row
  interface RowScored {
    p: SnapshotProtocol;
    yh: number;
    v50: number;
    v10: number;
    v90: number;
    plRaw: number;
    pl: number;
    implied: number;
    alphaG: number;
    age: number | null;
  }

  const scoredList: RowScored[] = [];
  for (const p of chosenMap.values()) {
    const yh = aMatch.predict(p, finalFitA.ctx, finalFitA.alpha, finalFitA.beta, resMatch.kept[0]);
    const s = Math.sqrt(1 + 1 / (aMatch.n_g[macroGroup(p.category)]! + 3));
    const v50 = Math.exp(yh + confMatch.med_r);
    const v10 = Math.exp(yh + s * confMatch.q10);
    const v90 = Math.exp(yh + s * confMatch.q90);
    const plRaw = b.pLaunch(p);
    const pl = roundJs(plRaw * 10000) / 10000;
    const implied = Math.max(1, roundJs(plRaw * v50));
    const alphaG = finalFitA.alpha[macroGroup(p.category)] ?? 0.0;
    const age = ageDays(snapshot.as_of, p.listed_at);
    scoredList.push({ p, yh, v50, v10, v90, plRaw, pl, implied, alphaG, age });
  }

  // Verdict thresholds
  const nonSkipP = scoredList
    .map((r) => r.pl)
    .filter((v) => v >= 0.25)
    .sort((x, y) => x - y);
  const q70P = nonSkipP.length > 0 ? quantileSorted(nonSkipP, 0.70) : 0.45;
  const allImplied = scoredList.map((r) => r.implied).sort((x, y) => x - y);
  const q75Iv = quantileSorted(allImplied, 0.75);
  const pFloor = Math.max(0.45, q70P);

  // Sort board by (-implied, slug)
  scoredList.sort((x, y) => y.implied - x.implied || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0));

  const watchlistSet = new Set(snapshot.watchlist);
  const counts: Record<string, number> = { farm: 0, watch: 0, skip: 0 };

  const board: BoardRow[] = scoredList.map((r, i) => {
    let verdict: 'farm' | 'watch' | 'skip';
    if (r.pl < 0.25) {
      verdict = 'skip';
    } else if (r.pl >= pFloor && r.implied >= q75Iv) {
      verdict = 'farm';
    } else {
      verdict = 'watch';
    }
    counts[verdict]++;

    return {
      rank: i + 1,
      slug: r.p.slug,
      name: r.p.name,
      category: r.p.category,
      chains: r.p.chains,
      tvl_usd: r.p.tvl_usd,
      change_7d: r.p.change_7d,
      mcap_usd: r.p.mcap_usd,
      listed_at: r.p.listed_at,
      gecko_id: r.p.gecko_id,
      symbol: r.p.symbol,
      token_status: 'pre-token',
      age_days: r.age,
      implied_value_usd: r.implied,
      is_watchlist: watchlistSet.has(r.p.slug),
      verdict,
      model: {
        v50: roundJs(r.v50),
        v10: roundJs(r.v10),
        v90: roundJs(r.v90),
        p_launch: r.pl,
        y_hat: roundJs(r.yh * 1e4) / 1e4,
        alpha_group: roundJs(r.alphaG * 1e4) / 1e4,
        med_r: roundJs(confMatch.med_r * 1e4) / 1e4,
        age_days: r.age,
      },
      farm_steps: farmSteps(r.p, r.pl, r.age).map(stepText),
    };
  });

  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !watchlistSet.has(r.slug)).length;

  const oofScatter = resMatch.oofFinal.map(([y, yh, slug]) => ({
    slug,
    actual_ln: roundJs(y * 1000) / 1000,
    pred_ln: roundJs(yh * 1000) / 1000,
  }));

  const mShrStr =
    finalFitA.m_shr === null
      ? null
      : finalFitA.m_shr === Infinity
      ? 'inf'
      : String(finalFitA.m_shr);

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    calibration_count: aMatch.L.length,
    rows: board.map((b) => ({
      rank: b.rank,
      slug: b.slug,
      name: b.name,
      category: b.category,
      chains: b.chains,
      tvl_usd: b.tvl_usd,
      change_7d: round2(b.change_7d),
      age_days: b.age_days,
      implied_value_usd: b.implied_value_usd,
      v50_usd: b.model.v50,
      v10_usd: b.model.v10,
      v90_usd: b.model.v90,
      p_launch: b.model.p_launch,
      verdict: b.verdict,
      is_watchlist: b.is_watchlist,
    })),
    live,
    validation: {
      stage_a: {
        match: {
          n: aMatch.L.length,
          table: resMatch.table,
          kept_free: resMatch.kept[0],
          kept_offset: resMatch.kept[1],
          conformal: confMatch,
        },
        all: {
          n: aAll.L.length,
          table: resAll.table,
          conformal: confAll,
        },
        final_fit: {
          lambda: finalFitA.lam,
          m_shr: mShrStr,
          lam_m1: finalFitA.lam_m1,
          beta: finalFitA.beta,
          alpha: finalFitA.alpha,
          winsor_bounds: finalFitA.ctx.bounds,
          n_g: aMatch.n_g,
        },
      },
      stage_b: {
        target: b.targetName(),
        p0: b.p0,
        cv: cvB,
        keep_F: cvB.final.keep_F,
        keep_dsvc: cvB.final.keep_dsvc,
        m_b1: b.m_b1,
        p0_full: b.p0_full,
        cure: {
          w0: b.cure_full.w0,
          tau: b.cure_full.tau,
          m: b.cure_full.m,
          p0_asym: b.cure_full.p0_asym,
        },
        d_service: b.dsvc_full,
        d_service_stats: b.dsvc_stats,
      },
      verdicts: {
        q70_p: q70P,
        p_floor: pFloor,
        q75_implied: q75Iv,
        counts,
      },
      oof_scatter: oofScatter,
    },
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
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
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
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

// Compact data.js generator: packs rows, live, ft, and validation
export function dataScript(radar: RadarData): string {
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
    roundJs(r.p_launch * 1e4),
    r.verdict === 'farm' ? 0 : r.verdict === 'watch' ? 1 : 2,
    r.v50_usd,
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

  const round4Val = (n: number | null | undefined): number | null =>
    n !== null && n !== undefined && Number.isFinite(n) ? roundJs(n * 1e4) / 1e4 : null;

  function packTable(table: AblationRow[]): unknown[] {
    return table.map((r) => [
      r.model,
      round4Val(r.rmsle),
      round4Val(r.mae_log),
      round4Val(r.medape),
      round4Val(r.spearman_mean_fold),
      round4Val(r.spearman_pooled),
      round4Val(r.ndcg20),
      round4Val(r.delta),
      round4Val(r.delta_mae),
      r.kept ? 1 : 0,
      r.m_shr_per_fold ?? null,
    ]);
  }

  const rawMatchTable = packTable(radar.validation.stage_a.match.table);
  const rawAllTable = packTable(radar.validation.stage_a.all.table);
  const rawScatter = radar.validation.oof_scatter.map((s) => [s.slug, s.actual_ln, s.pred_ln]);

  const valData = {
    a_m_n: radar.validation.stage_a.match.n,
    a_m_kf: radar.validation.stage_a.match.kept_free,
    a_m_ko: radar.validation.stage_a.match.kept_offset ? 1 : 0,
    a_m_c: [
      round4Val(radar.validation.stage_a.match.conformal.med_r),
      round4Val(radar.validation.stage_a.match.conformal.q10),
      round4Val(radar.validation.stage_a.match.conformal.q90),
      round2(radar.validation.stage_a.match.conformal.coverage_pct),
      radar.validation.stage_a.match.conformal.n,
    ],
    a_a_n: radar.validation.stage_a.all.n,
    a_a_c: [
      round4Val(radar.validation.stage_a.all.conformal.med_r),
      round4Val(radar.validation.stage_a.all.conformal.q10),
      round4Val(radar.validation.stage_a.all.conformal.q90),
      round2(radar.validation.stage_a.all.conformal.coverage_pct),
      radar.validation.stage_a.all.conformal.n,
    ],
    a_ff: {
      l: radar.validation.stage_a.final_fit.lambda,
      m: radar.validation.stage_a.final_fit.m_shr,
      lm1: radar.validation.stage_a.final_fit.lam_m1,
      b: radar.validation.stage_a.final_fit.beta.map((b) => round4Val(b)!),
      a: Object.fromEntries(
        Object.entries(radar.validation.stage_a.final_fit.alpha).map(([k, v]) => [
          k,
          round4Val(v)!,
        ]),
      ),
      wb: radar.validation.stage_a.final_fit.winsor_bounds.map((b) => round4Val(b)!),
      ng: radar.validation.stage_a.final_fit.n_g,
    },
    b_t: radar.validation.stage_b.target,
    b_p0: round4Val(radar.validation.stage_b.p0)!,
    b_cv: {
      b0: [round4Val(radar.validation.stage_b.cv.b0.auc)!, round4Val(radar.validation.stage_b.cv.b0.brier)!],
      b1: [round4Val(radar.validation.stage_b.cv.b1.auc)!, round4Val(radar.validation.stage_b.cv.b1.brier)!],
      b2: [round4Val(radar.validation.stage_b.cv.b2.auc)!, round4Val(radar.validation.stage_b.cv.b2.brier)!],
      b3: [round4Val(radar.validation.stage_b.cv.b3.auc)!, round4Val(radar.validation.stage_b.cv.b3.brier)!, radar.validation.stage_b.cv.b3.base],
      f: [
        round4Val(radar.validation.stage_b.cv.final.auc)!,
        round4Val(radar.validation.stage_b.cv.final.brier)!,
        radar.validation.stage_b.cv.final.keep_F ? 1 : 0,
        radar.validation.stage_b.cv.final.keep_dsvc ? 1 : 0,
        round4Val(radar.validation.stage_b.cv.final.bss)!,
      ],
    },
    b_kf: radar.validation.stage_b.keep_F ? 1 : 0,
    b_kd: radar.validation.stage_b.keep_dsvc ? 1 : 0,
    b_mb1: radar.validation.stage_b.m_b1,
    b_p0f: round4Val(radar.validation.stage_b.p0_full)!,
    b_cure: [
      radar.validation.stage_b.cure.w0,
      radar.validation.stage_b.cure.tau,
      radar.validation.stage_b.cure.m,
      round4Val(radar.validation.stage_b.cure.p0_asym)!,
    ],
    b_dsvc: round4Val(radar.validation.stage_b.d_service)!,
    b_dst: [
      radar.validation.stage_b.d_service_stats[0]!,
      radar.validation.stage_b.d_service_stats[1]!,
      round4Val(radar.validation.stage_b.d_service_stats[2])!,
    ],
    v_q70: round4Val(radar.validation.verdicts.q70_p)!,
    v_pf: round4Val(radar.validation.verdicts.p_floor)!,
    v_q75: roundJs(radar.validation.verdicts.q75_implied),
    v_c: radar.validation.verdicts.counts,
  };

  return `window.RADAR=(function(){var c=${JSON.stringify(cats)},h=${JSON.stringify(chainsPool)},k=["rank","slug","name","category","chains","tvl_usd","g7","ag","iv","p_launch","v_code","cf","s2","hd","wl"],lk=["slug","name","category","chains","tvl_usd","mcap_usd","g7"],vm=["farm","watch","skip"],tk=["model","rmsle","mae_log","medape","spearman_mean_fold","spearman_pooled","ndcg20","delta","delta_mae","kept","m_shr_per_fold"],r=${JSON.stringify(rowTuples)},l=${JSON.stringify(liveTuples)},ft=${JSON.stringify(ft)},vd=${JSON.stringify(valData)},tm=${JSON.stringify(rawMatchTable)},ta=${JSON.stringify(rawAllTable)},sc=${JSON.stringify(rawScatter)};function unpackTbl(tbl){return tbl.map(function(row){var o={};tk.forEach(function(key,idx){o[key]=key==="kept"?row[idx]===1:row[idx]});return o;});}function unpackConf(arr){return{med_r:arr[0],q10:arr[1],q90:arr[2],coverage_pct:arr[3],n:arr[4]};}var val={stage_a:{match:{n:vd.a_m_n,table:unpackTbl(tm),kept_free:vd.a_m_kf,kept_offset:vd.a_m_ko===1,conformal:unpackConf(vd.a_m_c)},all:{n:vd.a_a_n,table:unpackTbl(ta),conformal:unpackConf(vd.a_a_c)},final_fit:{lambda:vd.a_ff.l,m_shr:vd.a_ff.m,lam_m1:vd.a_ff.lm1,beta:vd.a_ff.b,alpha:vd.a_ff.a,winsor_bounds:vd.a_ff.wb,n_g:vd.a_ff.ng}},stage_b:{target:vd.b_t,p0:vd.b_p0,cv:{b0:{auc:vd.b_cv.b0[0],brier:vd.b_cv.b0[1]},b1:{auc:vd.b_cv.b1[0],brier:vd.b_cv.b1[1]},b2:{auc:vd.b_cv.b2[0],brier:vd.b_cv.b2[1]},b3:{auc:vd.b_cv.b3[0],brier:vd.b_cv.b3[1],base:vd.b_cv.b3[2]},final:{auc:vd.b_cv.f[0],brier:vd.b_cv.f[1],keep_F:vd.b_cv.f[2]===1,keep_dsvc:vd.b_cv.f[3]===1,bss:vd.b_cv.f[4]}},keep_F:vd.b_kf===1,keep_dsvc:vd.b_kd===1,m_b1:vd.b_mb1,p0_full:vd.b_p0f,cure:{w0:vd.b_cure[0],tau:vd.b_cure[1],m:vd.b_cure[2],p0_asym:vd.b_cure[3]},d_service:vd.b_dsvc,d_service_stats:vd.b_dst},verdicts:{q70_p:vd.v_q70,p_floor:vd.v_pf,q75_implied:vd.v_q75,counts:vd.v_c},oof_scatter:sc.map(function(t){return{slug:t[0],actual_ln:t[1],pred_ln:t[2]};})};return{as_of:${JSON.stringify(radar.as_of)},source:${JSON.stringify(radar.source)},floor_usd:${radar.floor_usd},model_version:${JSON.stringify(radar.model_version)},watchlist_size:${radar.watchlist_size},board_size:${radar.board_size},early_size:${radar.early_size},live_size:${radar.live_size},calibration_count:${radar.calibration_count},ft:ft,validation:val,rows:r.map(function(v){var o={};k.forEach(function(p,i){o[p]=v[i]});o.category=o.category>=0?c[o.category]:null;o.verdict=vm[o.v_code];o.p_launch=o.p_launch/1e4;o.m_cat=0;o.s_tvl=0;o.g_7d=0;o.a_age=0;o.c_chains=0;o.v50_usd=o.cf;o.chains=o.chains!==""?o.chains.split(";").map(function(i){return h[+i]}):[];return o}),live:l.map(function(v){var o={};lk.forEach(function(p,i){o[p]=v[i]});o.category=o.category>=0?c[o.category]:null;o.chains=o.chains!==""?o.chains.split(";").map(function(i){return h[+i]}):[];return o})}})();\n`;
}
