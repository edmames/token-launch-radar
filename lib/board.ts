// lib/board.ts: Enriched Radar & Board engine with Costed Farm ROI and Live Comps
// radar-4.1 implementation

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
  FARM_STEP1_TEMPLATE_ETH,
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
  attr: [number, number, number, number, number];
}

export interface RadarData extends Omit<BaseRadarData, 'rows'> {
  rows: RadarRow[];
  comps_pool?: CompPoolEntry[];
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

  const finalFitBeta = baseRadar.validation.stage_a.final_fit.beta;
  const keptFree = baseRadar.validation.stage_a.match.kept_free;
  const x5Idx = keptFree.indexOf('x5');
  const b0 = finalFitBeta[0]!;
  const b1 = finalFitBeta[1]!;
  const b5 = x5Idx >= 0 ? finalFitBeta[x5Idx + 1]! : 0;

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
        gas_per_tx: r.gas_per_tx,
        bridge_usd: r.bridge_usd,
        tx_count: r.tx_count,
      },
      nearest_comps: comps,
      farm_steps: steps,
    });

    const tvlTerm = b1 * Math.log(p.tvl_usd);
    const chainsTerm = b5 ? b5 * Math.log(Math.max(1, (p.chains ?? []).length)) : 0;
    const alpha = row.model.alpha_group;
    const medR = row.model.med_r;
    const attr: [number, number, number, number, number] = [
      roundJs(b0 * 100) / 100,
      roundJs(tvlTerm * 100) / 100,
      roundJs(chainsTerm * 100) / 100,
      roundJs(alpha * 100) / 100,
      roundJs(medR * 100) / 100,
    ];

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
      attr,
    });
  }

  const radar: RadarData = {
    ...baseRadar,
    rows: enrichedRows,
    comps_pool: pool,
  };

  return { board, radar };
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : ''))
    .join(' ');
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

  function getChainIdx(ch: string): number {
    let idx = chainsPool.indexOf(ch);
    if (idx < 0) {
      idx = chainsPool.length;
      chainsPool.push(ch);
    }
    return idx;
  }

  const round1 = (n: number | null | undefined): number | null =>
    n !== null && n !== undefined && Number.isFinite(n) ? roundJs(n * 10) / 10 : null;
  const round2 = (n: number | null | undefined): number | null =>
    n !== null && n !== undefined && Number.isFinite(n) ? roundJs(n * 100) / 100 : null;
  const round3 = (n: number | null | undefined): number | null =>
    n !== null && n !== undefined && Number.isFinite(n) ? roundJs(n * 1000) / 1000 : null;
  const round4 = (n: number | null | undefined): number | null =>
    n !== null && n !== undefined && Number.isFinite(n) ? roundJs(n * 1e4) / 1e4 : null;

  const pool = radar.comps_pool ?? [];
  const poolSlugMap = new Map<string, number>();
  const cpTuples = pool.map((p, idx) => {
    poolSlugMap.set(p.slug, idx);
    const tcName = titleCase(p.slug);
    const tvl10k = roundJs(p.tvl_usd / 10000);
    const mcap10k = roundJs(tvl10k * (p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : 0));
    return [
      p.slug,
      p.name === tcName ? '' : p.name,
      catId(p.category),
      tvl10k,
      mcap10k,
    ];
  });

  const rowTuples = radar.rows.map((r) => {
    const c0 = r.comps[0]!;
    const c1 = r.comps[1]!;
    const c2 = r.comps[2]!;
    const idx0 = poolSlugMap.get(c0[0]) ?? 0;
    const idx1 = poolSlugMap.get(c1[0]) ?? 0;
    const idx2 = poolSlugMap.get(c2[0]) ?? 0;

    const tcName = titleCase(r.slug);

    return [
      r.slug,
      r.name === tcName ? '' : r.name,
      catId(r.category),
      chainIds(r.chains),
      roundJs(r.tvl_usd / 10000),
      round2(r.change_7d),
      r.age_days,
      r.implied_value_usd,
      roundJs(r.p_launch * 10000),
      r.verdict === 'farm' ? 0 : r.verdict === 'watch' ? 1 : 2,
      roundJs(r.v50_usd / 1000),
      roundJs(r.y_airdrop_ann * 1e4),
      roundJs(r.k_min / 250),
      roundJs(r.c_hard * 100),
      roundJs(r.gross_hold * 1e4),
      roundJs(r.net_cash_ev_10k * 100),
      getChainIdx(r.exec_chain),
      r.is_watchlist ? 1 : 0,
      idx0,
      roundJs(c0[2] * 1000),
      idx1,
      roundJs(c1[2] * 1000),
      idx2,
      roundJs(c2[2] * 1000),
      roundJs(r.attr[3] * 100),
    ];
  });

  const liveTuples = radar.live.map((l) => [
    l.slug,
    l.name === titleCase(l.slug) ? '' : l.name,
    catId(l.category),
    chainIds(l.chains),
    roundJs(l.tvl_usd / 1000),
    roundJs(l.mcap_usd / 1000),
    round2(l.change_7d),
  ]);

  const vp: [number, number][] = [];
  const vpKeyToIdx = new Map<string, number>();
  const catVr = new Map<string, number>();
  for (const r of radar.rows) {
    const r10 = roundJs((r.v10_usd / r.v50_usd) * 1000);
    const r90 = roundJs((r.v90_usd / r.v50_usd) * 1000);
    const key = `${r10},${r90}`;
    let idx = vpKeyToIdx.get(key);
    if (idx === undefined) {
      idx = vp.length;
      vpKeyToIdx.set(key, idx);
      vp.push([r10, r90]);
    }
    if (r.category && !catVr.has(r.category)) {
      catVr.set(r.category, idx);
    }
  }
  const catVrArr = cats.map((c) => catVr.get(c) ?? 0);
  const catS2Arr = cats.map((c) => getFarmStep2Variant(c));

  const ft = {
    s: SKIP_TEMPLATES.map((t) => [t.text, t.cost, t.time]),
    f: [
      [FARM_STEP1_TEMPLATE.text, FARM_STEP1_TEMPLATE_ETH.text, FARM_STEP1_TEMPLATE.cost, FARM_STEP1_TEMPLATE.time],
      [FARM_STEP2_TEMPLATES, FARM_STEP2_META.cost, FARM_STEP2_META.time],
      [FARM_STEP3_TEMPLATES.map((t) => t.text), FARM_STEP3_TEMPLATES[0].cost, '10 min'],
      [FARM_STEP4_TEMPLATES.map((t) => t.text), '$0 gas', FARM_STEP4_TEMPLATES.map((t) => t.time)],
      [FARM_STEP5_TEMPLATES.map((t) => t.text), FARM_STEP5_TEMPLATES[0].cost, '10-15 min'],
    ],
  };

  const val = radar.validation;
  function packTable(table: any[]): any[] {
    return table.map((r) => [
      r.model,
      round4(r.rmsle),
      round4(r.mae_log),
      round4(r.spearman_mean_fold),
      round4(r.ndcg20),
      round4(r.delta),
      r.kept ? 1 : 0,
    ]);
  }

  const rawMatchTable = packTable(val.stage_a.match.table);
  const rawAllTable = packTable(val.stage_a.all.table);
  const rawScatter: number[] = [];
  for (const s of val.oof_scatter) {
    rawScatter.push(roundJs(s.actual_ln * 10), roundJs(s.pred_ln * 10));
  }

  const valData = [
    val.stage_a.match.n,
    val.stage_a.match.kept_free,
    val.stage_a.match.kept_offset ? 1 : 0,
    [
      round3(val.stage_a.match.conformal.med_r),
      round3(val.stage_a.match.conformal.q10),
      round3(val.stage_a.match.conformal.q90),
      round1(val.stage_a.match.conformal.coverage_pct),
      val.stage_a.match.conformal.n,
    ],
    val.stage_a.all.n,
    [
      val.stage_a.final_fit.lambda,
      val.stage_a.final_fit.m_shr,
      val.stage_a.final_fit.beta.map((b) => round4(b)!),
      Object.fromEntries(
        Object.entries(val.stage_a.final_fit.alpha).map(([k, v]) => [k, round3(v)!]),
      ),
    ],
    val.stage_b.target,
    round3(val.stage_b.p0)!,
    [
      [round3(val.stage_b.cv.b0.auc)!, round3(val.stage_b.cv.b0.brier)!],
      [round3(val.stage_b.cv.b1.auc)!, round3(val.stage_b.cv.b1.brier)!],
      [round3(val.stage_b.cv.b2.auc)!, round3(val.stage_b.cv.b2.brier)!],
      [round3(val.stage_b.cv.b3.auc)!, round3(val.stage_b.cv.b3.brier)!, val.stage_b.cv.b3.base],
      [
        round3(val.stage_b.cv.final.auc)!,
        round3(val.stage_b.cv.final.brier)!,
        val.stage_b.cv.final.keep_F ? 1 : 0,
        val.stage_b.cv.final.keep_dsvc ? 1 : 0,
        round3(val.stage_b.cv.final.bss)!,
      ],
    ],
    [
      val.stage_b.cure.w0,
      val.stage_b.cure.tau,
      val.stage_b.cure.m,
      round3(val.stage_b.cure.p0_asym)!,
    ],
    round3(val.stage_b.d_service)!,
    round3(val.verdicts.p_floor)!,
    roundJs(val.verdicts.q75_implied),
    val.verdicts.counts,
  ];

  return `window.RADAR=(function(){var c=${JSON.stringify(cats)},h=${JSON.stringify(chainsPool)},vm=["farm","watch","skip"],cp=${JSON.stringify(cpTuples)},r=${JSON.stringify(rowTuples)},l=${JSON.stringify(liveTuples)},ft=${JSON.stringify(ft)},vd=${JSON.stringify(valData)},tm=${JSON.stringify(rawMatchTable)},ta=${JSON.stringify(rawAllTable)},sc=${JSON.stringify(rawScatter)},vp=${JSON.stringify(vp)},vr=${JSON.stringify(catVrArr)},s2a=${JSON.stringify(catS2Arr)};function tc(s){return s.split("-").map(function(w){return w?w[0].toUpperCase()+w.slice(1):"";}).join(" ");}function uT(t){return t.map(function(r){return{model:r[0],rmsle:r[1],mae_log:r[2],spearman_mean_fold:r[3],ndcg20:r[4],delta:r[5],kept:r[6]===1};});}function uC(a){return{med_r:a[0],q10:a[1],q90:a[2],coverage_pct:a[3],n:a[4]};}var scatter=[];for(var i=0;i<sc.length;i+=2)scatter.push({actual_ln:sc[i]/10,pred_ln:sc[i+1]/10});var poolObj=cp.map(function(p){return{slug:p[0],name:p[1]||tc(p[0]),category:p[2]>=0?c[p[2]]:null,tvl_usd:p[3]*10000,mcap_usd:p[4]*10000};});function ratioOf(i){return poolObj[i].tvl_usd>0?poolObj[i].mcap_usd/poolObj[i].tvl_usd:0;}var b0=Math.round(vd[5][2][0]*100)/100,b1=vd[5][2][1],medR=Math.round(vd[3][0]*100)/100,b5=vd[5][2][2]||0;function cO(x){return{auc:x[0],brier:x[1]};}var val={stage_a:{match:{n:vd[0],table:uT(tm),kept_free:vd[1],kept_offset:vd[2]===1,conformal:uC(vd[3])},all:{n:vd[4],table:uT(ta)},final_fit:{lambda:vd[5][0],m_shr:vd[5][1],beta:vd[5][2],alpha:vd[5][3]}},stage_b:{target:vd[6],p0:vd[7],cv:{b0:cO(vd[8][0]),b1:cO(vd[8][1]),b2:cO(vd[8][2]),b3:{auc:vd[8][3][0],brier:vd[8][3][1],base:vd[8][3][2]},final:{auc:vd[8][4][0],brier:vd[8][4][1],keep_F:vd[8][4][2]===1,keep_dsvc:vd[8][4][3]===1,bss:vd[8][4][4]}},cure:{w0:vd[9][0],tau:vd[9][1],m:vd[9][2],p0_asym:vd[9][3]},d_service:vd[10]},verdicts:{p_floor:vd[11],q75_implied:vd[12],counts:vd[13]},oof_scatter:scatter};return{as_of:${JSON.stringify(radar.as_of)},source:${JSON.stringify(radar.source)},watchlist_size:${radar.watchlist_size},floor_usd:${radar.floor_usd},model_version:${JSON.stringify(radar.model_version)},ft:ft,validation:val,cp:poolObj,live:l.map(function(v){return{slug:v[0],name:v[1]||tc(v[0]),category:v[2]>=0?c[v[2]]:null,chains:v[3]!==""?v[3].split(";").map(function(i){return h[+i]}):[],tvl_usd:v[4]*1000,mcap_usd:v[5]*1000,change_7d:v[6]};}),rows:r.map(function(v,i){var cat=v[2]>=0?c[v[2]]:null,ac=(cat==="Derivatives"||cat==="Prediction Market"||cat==="Interest Rate Derivatives")?0.25:(cat==="Dexs"||cat==="Chain")?0.22:0.20,hd=ac===0.20?45:52.5,tm=ac===0.25?213:ac===0.22?133:47,v50=v[10]*1000,pr=vp[vr[v[2]]]||vp[0],chs=v[3]!==""?v[3].split(";").map(function(j){return h[+j]}):[],b2=b5?Math.round(b5*Math.log(Math.max(1,chs.length))*100)/100:0,tvlT=Math.round(b1*Math.log(v[4]*10000)*100)/100;return{rank:i+1,slug:v[0],name:v[1]||tc(v[0]),category:cat,chains:chs,tvl_usd:v[4]*10000,change_7d:v[5],age_days:v[6],implied_value_usd:v[7],p_launch:v[8]/10000,verdict:vm[v[9]],v50_usd:v50,v10_usd:Math.round(v50*(pr[0]/1000)),v90_usd:Math.round(v50*(pr[1]/1000)),y_airdrop_ann:v[11]/1e4,k_min:v[12]*250,c_hard:v[13]/100,total_min:tm,gross_hold:v[14]/1e4,net_cash_ev_10k:v[15]/100,exec_chain:h[v[16]]||"Ethereum",alpha_circ:ac,hold_days:hd,s2:s2a[v[2]]!=null?s2a[v[2]]:11,is_watchlist:v[17]===1,comps:[[v[18],ratioOf(v[18]),v[19]/1000],[v[20],ratioOf(v[20]),v[21]/1000],[v[22],ratioOf(v[22]),v[23]/1000]],attr:[b0,tvlT,b2,v[24]/100,medR]};})}})();\n`;
}

export { boardIssue };
