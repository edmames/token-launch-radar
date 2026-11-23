// lib/board.ts: Board engine and compact data serialization for radar-5.2

import {
  boardIssue,
  buildRadar,
  buildRadarBase,
} from './model.ts';
import type {
  BoardRow,
  RadarData,
  RadarRow,
  Snapshot,
} from './model.ts';
import {
  GAS_DEFAULT,
  GAS_TABLE,
  STEP_TEMPLATES,
} from './farm.ts';
import { roundJs } from './stats.ts';

export type { BoardRow, RadarData, RadarRow, Snapshot };
export { boardIssue, buildRadar, buildRadarBase };

/**
 * 32-bit FNV-1a hash algorithm (offset 0x811c9dc5, prime 0x01000193).
 * Returns an 8-character lowercase zero-padded hexadecimal string.
 */
export function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Recomputes implied valuation from packed v50 and p_odds.
 */
export function impliedFromPacked(v50: number, p_odds: number): number {
  return Math.max(1, roundJs(p_odds * v50));
}

/**
 * Helper to compute the FNV-1a 32-bit checksum for the board implied values.
 */
export function computeRadarChecksum(
  rows: Array<{
    v50_usd?: number;
    v50?: number;
    model?: { v50: number; p_launch: number };
    p_launch?: number;
    p_odds?: number;
  }>,
): string {
  const impliedVals = rows.map((r) => {
    const v50 = r.v50_usd ?? r.v50 ?? r.model?.v50 ?? 0;
    const p = r.p_launch ?? r.p_odds ?? r.model?.p_launch ?? 0;
    return impliedFromPacked(v50, p);
  });
  return fnv1a32(impliedVals.join(','));
}

function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function gateCodeToInt(gc: string): number {
  const s = (gc || '').toLowerCase();
  let code = 0;
  if (s.includes('parent')) code |= 1;
  if (s.includes('chain-sub') || s.includes('chain_sub')) code |= 2;
  if (s.includes('native')) code |= 4;
  return code;
}

function packStatus(status: string): 'b' | 'k' | 'n' | 'm' {
  if (status.startsWith('baseline')) return 'b';
  if (status.startsWith('kept')) return 'k';
  if (status.startsWith('tested')) return 'n';
  if (status.startsWith('must')) return 'm';
  throw new Error(`Unknown ablation status: ${status}`);
}

/**
 * Packs RadarData into a compact client payload (~26-30 KB) for the browser dashboard.
 */
export function dataScript(radar: RadarData): string {
  // Checksum over the 200 implied values
  const checksum = computeRadarChecksum(radar.rows);

  const watchlist_idx: number[] = [];
  radar.rows.forEach((r, idx) => {
    if (r.is_watchlist) watchlist_idx.push(idx);
  });

  const stageA = radar.validation.stage_a;
  const stageB = radar.validation.stage_b;

  // Meta block
  const meta = {
    as_of: radar.as_of,
    model_version: 'radar-5.2',
    checksum,
    p5_7d: roundJs(radar.p5_7d * 1e6) / 1e6,
    watchlist_size: radar.watchlist_size,
    watchlist_idx,
    board_size: radar.board_size,
    early_size: radar.early_size,
    calibration_count: radar.calibration_count,
    ledTot: radar.validation.ledger.total,
    b_n: stageB.n_protocols,
  };

  // Categories pool
  const catSet = new Set<string>();
  for (const r of radar.rows) if (r.category) catSet.add(r.category);
  for (const p of radar.comps_pool ?? []) if (p.category) catSet.add(p.category);
  const cats = Array.from(catSet).sort();
  const catMap = new Map<string, number>(cats.map((c, i) => [c, i]));

  // Chains pool (only chains present in board rows)
  const chainSet = new Set<string>();
  for (const r of radar.rows) {
    for (const ch of r.chains ?? []) chainSet.add(ch);
  }
  const chains = Array.from(chainSet).sort();
  const chainMap = new Map<string, number>(chains.map((c, i) => [c, i]));

  // Gas table (only non-default entries present in chains)
  const gas: [number, number, number][] = [];
  for (const [ch, [g, b]] of Object.entries(GAS_TABLE)) {
    if (chainMap.has(ch)) {
      if (Math.abs(g - GAS_DEFAULT[0]) > 1e-6 || Math.abs(b - GAS_DEFAULT[1]) > 1e-6) {
        gas.push([chainMap.get(ch)!, g, b]);
      }
    }
  }

  // Comps pool (cp: 119 entries)
  const cpPool = radar.comps_pool ?? [];
  const cp_packed = cpPool.map((p) => {
    const nameOv = p.name === titleCaseSlug(p.slug) ? '' : p.name;
    return [
      p.slug,
      nameOv,
      p.symbol ?? '',
      catMap.get(p.category ?? '') ?? -1,
      roundJs(p.tvl_usd / 10000.0),
      roundJs(p.mcap_usd / 10000.0),
      roundJs(p.oof_pred / 1000.0),
    ];
  });

  // Rows (200 tuples)
  const rows_packed = radar.rows.map((r) => {
    const nameOv = r.name === titleCaseSlug(r.slug) ? '' : r.name;
    const catId = catMap.get(r.category ?? '') ?? -1;
    const chainIds = (r.chains ?? []).map((ch) => chainMap.get(ch)!).filter((id) => id !== undefined);
    const tvl10k = roundJs(r.tvl_usd / 10000.0);
    const g7d = r.change_7d !== null ? roundJs(r.change_7d * 100) / 100 : null;
    const ageDays = r.age_days ?? null;
    const v50 = roundJs(r.v50_usd);
    const pOdds = roundJs(r.p_launch * 1e6);
    const gateCode = gateCodeToInt(r.gate_code);
    const compIdx = r.comp_idx ?? [];

    return [
      r.slug,
      nameOv,
      catId,
      chainIds,
      tvl10k,
      g7d,
      ageDays,
      v50,
      pOdds,
      gateCode,
      r.rank_lo,
      r.rank_hi,
      compIdx,
    ];
  });

  // Fit parameters (Stage A & Stage B)
  const fitA = stageA.final_fit;
  const fitB = stageB.final_fit;
  const confLoo = stageA.match.conformal_loo;
  const confWf = stageA.match.conformal_wf;

  const piHatEntries: [number, number][] = [];
  for (const [catName, piVal] of Object.entries(fitB.pi_hat_c ?? {})) {
    if (catMap.has(catName)) {
      piHatEntries.push([catMap.get(catName)!, roundJs(piVal * 10000) / 10000]);
    }
  }

  const fit = {
    beta0: roundJs(fitA.beta[0]! * 10000) / 10000,
    beta_size: roundJs(fitA.beta[1]! * 10000) / 10000,
    med_r: roundJs(fitA.med_r * 10000) / 10000,
    q10: roundJs(confLoo.q10 * 10000) / 10000,
    q25: roundJs(confLoo.q25 * 10000) / 10000,
    q75: roundJs(confLoo.q75 * 10000) / 10000,
    q90: roundJs(confLoo.q90 * 10000) / 10000,
    loo: roundJs(stageA.match.final_loo * 10000) / 10000,
    wf: roundJs(stageA.match.final_wf * 10000) / 10000,
    loo_base: roundJs(stageA.match.table[0]!.loo_typical_miss * 10000) / 10000,
    wf_base: roundJs(stageA.match.table[0]!.wf_typical_miss * 10000) / 10000,
    cov_loo: {
      x3: roundJs(confLoo.coverage.within_x3 * 10000) / 10000,
      p50: roundJs(confLoo.coverage.coverage_p25_p75 * 10000) / 10000,
      p80: roundJs(confLoo.coverage.coverage_p10_p90 * 10000) / 10000,
    },
    cov_wf: {
      x3: roundJs(confWf.coverage.within_x3 * 10000) / 10000,
      p50: roundJs(confWf.coverage.coverage_p25_p75 * 10000) / 10000,
      p80: roundJs(confWf.coverage.coverage_p10_p90 * 10000) / 10000,
    },
    gamma: fitB.gamma.map((x) => roundJs(x * 10000) / 10000),
    d_service: roundJs(fitB.d_service * 10000) / 10000,
    w0: fitB.w0,
    p0_asym: roundJs(fitB.p0_asym * 10000) / 10000,
    median_age_yr: roundJs(radar.median_age_yr * 1000) / 1000,
    pi_hat_c: piHatEntries,
    brier_wf: roundJs(stageB.final_kept_wf_brier * 10000) / 10000,
    brier_base_wf: roundJs(stageB.baseline_wf_brier * 10000) / 10000,
    acc_wf: roundJs((([...stageB.ablation].reverse().find((r) => r.status === 'kept') ?? stageB.ablation[1]!).acc_wf) * 10000) / 10000,
    acc_base_wf: roundJs(stageB.ablation[0]!.acc_wf * 10000) / 10000,
  };

  // Validation summary
  const termsA = stageA.match.table.map((r) => r.term);
  const termsB = stageB.ablation.map((r) => r.term);

  const ablA = stageA.match.table.map((r, i) => [
    i,
    roundJs(r.loo_typical_miss * 10000) / 10000,
    roundJs(r.wf_typical_miss * 10000) / 10000,
    r.t_stat !== null ? roundJs(r.t_stat * 100) / 100 : null,
    packStatus(r.status),
  ]);

  const ablB = stageB.ablation.map((r, i) => [
    i,
    roundJs(r.brier_10fold * 10000) / 10000,
    roundJs(r.acc_10fold * 10000) / 10000,
    roundJs(r.brier_wf * 10000) / 10000,
    roundJs(r.acc_wf * 10000) / 10000,
    packStatus(r.status),
  ]);

  const val = {
    terms_a: termsA,
    terms_b: termsB,
    abl_a: ablA,
    abl_b: ablB,
    se_a: [
      roundJs((fitA.beta_se?.beta0 ?? 0) * 10000) / 10000,
      roundJs((fitA.beta_se?.beta_x_tvl ?? 0) * 10000) / 10000,
    ],
    se_b: [
      roundJs((stageB.final_fit.gamma_se?.intercept ?? 0) * 10000) / 10000,
      roundJs((stageB.final_fit.gamma_se?.beta_age_yr ?? 0) * 10000) / 10000,
      roundJs((stageB.final_fit.gamma_se?.beta_tvl_lat ?? 0) * 10000) / 10000,
    ],
    ledger: radar.validation.ledger.groups,
  };

  const packed = {
    meta,
    cats,
    chains,
    gas,
    fit,
    rows: rows_packed,
    cp: cp_packed,
    val,
    steps: STEP_TEMPLATES,
  };

  return `window.RADAR=(function(){return ${JSON.stringify(packed)};})();\n`;
}
