// lib/board.ts: Enriched Radar & Board engine with Costed Farm ROI and Live Comps
// STEP 2b-PLAN-D implementation

import {
  boardIssue,
  buildRadar as buildRadarBase,
  macroGroup,
  NON_LAUNCH,
  VERSIONED,
} from './model.ts';
import type {
  BoardRow as BaseBoardRow,
  RadarData as BaseRadarData,
  RadarRow as BaseRadarRow,
  Snapshot,
} from './model.ts';
import {
  farmSteps,
  FARM_STEP1_TEMPLATE,
  FARM_STEP2_META,
  FARM_STEP2_TEMPLATES,
  FARM_STEP3_TEMPLATES,
  FARM_STEP4_TEMPLATES,
  FARM_STEP5_TEMPLATES,
  getFarmStep2Variant,
  nearestComps,
  roi,
  SKIP_TEMPLATES,
  stepText,
} from './farm.ts';
import type {
  CompPoolEntry,
  LiveComp,
  RoiResult,
} from './farm.ts';
import { roundJs } from './stats.ts';

export interface BoardRow extends BaseBoardRow {
  roi: RoiResult;
  nearest_comps: LiveComp[];
}

export interface RadarRow extends BaseRadarRow {
  y_airdrop_ann: number;
  k_min: number;
  c_hard: number;
  total_min: number;
  gross_hold: number;
  net_cash_ev_10k: number;
  exec_chain: string;
  alpha_circ: number;
  hold_days: number;
  s2: number;
  comps: [string, number, number][];
}

export interface RadarData extends Omit<BaseRadarData, 'rows'> {
  rows: RadarRow[];
}

export function liveMatchPool(snapshot: Snapshot): CompPoolEntry[] {
  const pool: CompPoolEntry[] = [];
  for (const p of snapshot.protocols) {
    const mcap = p.mcap_usd ?? 0;
    const tvl = p.tvl_usd ?? 0;
    const cat = p.category;
    if (
      mcap > 0 &&
      tvl >= 1e6 &&
      cat !== 'CEX' &&
      (cat === null || !NON_LAUNCH.has(cat)) &&
      !VERSIONED.test(p.name)
    ) {
      pool.push({
        slug: p.slug,
        name: p.name,
        category: cat,
        macro_group: macroGroup(cat),
        chains: p.chains ?? [],
        tvl_usd: tvl,
        mcap_usd: mcap,
      });
    }
  }
  return pool;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board: baseBoard, radar: baseRadar } = buildRadarBase(snapshot);
  const pool = liveMatchPool(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  const board: BoardRow[] = [];
  const enrichedRows: RadarRow[] = [];

  for (let i = 0; i < baseBoard.length; i++) {
    const row = baseBoard[i]!;
    const baseRadarRow = baseRadar.rows[i]!;
    const p = bySlug.get(row.slug);
    if (!p) {
      throw new Error(`Protocol with slug ${row.slug} not found in snapshot`);
    }

    const r = roi(p, row.implied_value_usd);
    const comps = nearestComps(
      {
        slug: p.slug,
        category: p.category,
        macro_group: macroGroup(p.category),
        chains: p.chains ?? [],
        tvl_usd: p.tvl_usd,
      },
      pool,
    );
    const steps = farmSteps(p, row.verdict, r).map(stepText);

    board.push({
      ...row,
      roi: {
        exec_chain: r.exec_chain,
        total_min: r.total_min,
        y_airdrop_ann: roundJs(r.y_airdrop_ann * 1e6) / 1e6,
        gross_hold: roundJs(r.gross_hold * 1e6) / 1e6,
        c_hard: roundJs(r.c_hard * 100) / 100,
        k_min: r.k_min,
        net_cash_ev_10k: roundJs(r.net_cash_ev_10k * 100) / 100,
        alpha_circ: r.alpha_circ,
        hold_days: r.hold_days,
      },
      nearest_comps: comps,
      farm_steps: steps,
    });

    enrichedRows.push({
      ...baseRadarRow,
      y_airdrop_ann: roundJs(r.y_airdrop_ann * 1e4) / 1e4,
      k_min: r.k_min,
      c_hard: roundJs(r.c_hard * 100) / 100,
      total_min: r.total_min,
      gross_hold: roundJs(r.gross_hold * 1e4) / 1e4,
      net_cash_ev_10k: roundJs(r.net_cash_ev_10k * 100) / 100,
      exec_chain: r.exec_chain,
      alpha_circ: r.alpha_circ,
      hold_days: r.hold_days,
      s2: getFarmStep2Variant(baseRadarRow.category),
      comps: comps.map((c) => [c.slug, c.ratio, c.distance] as [string, number, number]),
    });
  }

  const radar: RadarData = {
    ...baseRadar,
    rows: enrichedRows,
  };

  return { board, radar };
}

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

  const round2 = (n: number | null | undefined): number | null =>
    n !== null && n !== undefined && Number.isFinite(n) ? roundJs(n * 100) / 100 : null;

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
    r.v10_usd,
    r.v90_usd,
    roundJs(r.y_airdrop_ann * 1e4),
    r.k_min,
    roundJs(r.c_hard * 100),
    r.total_min,
    roundJs(r.gross_hold * 1e4),
    roundJs(r.net_cash_ev_10k * 100),
    r.exec_chain,
    r.alpha_circ,
    r.hold_days,
    r.s2,
    r.comps.map((c) => `${c[0]},${c[1]},${c[2]}`).join('|'),
    r.is_watchlist ? 1 : 0,
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

  return `window.RADAR=(function(){var c=${JSON.stringify(cats)},h=${JSON.stringify(chainsPool)},vm=["farm","watch","skip"],r=${JSON.stringify(rowTuples)},ft=${JSON.stringify(ft)},live=${JSON.stringify(radar.live)},val=${JSON.stringify(radar.validation)};return{as_of:${JSON.stringify(radar.as_of)},source:${JSON.stringify(radar.source)},floor_usd:${radar.floor_usd},model_version:${JSON.stringify(radar.model_version)},watchlist_size:${radar.watchlist_size},board_size:${radar.board_size},early_size:${radar.early_size},live_size:${radar.live_size},calibration_count:${radar.calibration_count},ft:ft,validation:val,live:live,rows:r.map(function(v){return{rank:v[0],slug:v[1],name:v[2],category:v[3]>=0?c[v[3]]:null,chains:v[4]!==""?v[4].split(";").map(function(i){return h[+i]}):[],tvl_usd:v[5],change_7d:v[6],age_days:v[7],implied_value_usd:v[8],p_launch:v[9]/1e4,verdict:vm[v[10]],v50_usd:v[11],v10_usd:v[12],v90_usd:v[13],y_airdrop_ann:v[14]/1e4,k_min:v[15],c_hard:v[16]/100,total_min:v[17],gross_hold:v[18]/1e4,net_cash_ev_10k:v[19]/100,exec_chain:v[20],alpha_circ:v[21],hold_days:v[22],s2:v[23],comps:v[24]?v[24].split("|").map(function(s){var p=s.split(",");return[p[0],+p[1],+p[2]]}):[],is_watchlist:v[25]===1,m_cat:0,s_tvl:0,g_7d:0,a_age:0,c_chains:0}})}})();\n`;
}

export { boardIssue };
