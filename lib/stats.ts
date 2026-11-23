// lib/stats.ts: Mathematical and statistical routines for radar-5.2
// Ported 1:1 from verify-r5.py

export function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r]![col]!);
      if (val > maxVal) {
        maxVal = val;
        piv = r;
      }
    }
    if (maxVal < 1e-12) {
      throw new Error('singular matrix');
    }
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const pv = M[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r !== col && M[r]![col] !== 0) {
        const f = M[r]![col]! / pv;
        for (let c = col; c <= n; c++) {
          M[r]![c]! -= f * M[col]![c]!;
        }
      }
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

export function dot(x: number[], beta: number[]): number {
  let s = 0.0;
  for (let i = 0; i < x.length; i++) {
    s += x[i]! * beta[i]!;
  }
  return s;
}

export function wls(X: number[][], y: number[], w?: number[]): number[] {
  const p = X[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0.0));
  const Xty: number[] = new Array(p).fill(0.0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    const yi = y[i]!;
    const wi = w === undefined ? 1.0 : w[i]!;
    for (let a = 0; a < p; a++) {
      Xty[a]! += wi * xi[a]! * yi;
      for (let b = 0; b < p; b++) {
        XtX[a]![b]! += wi * xi[a]! * xi[b]!;
      }
    }
  }
  return solveLinear(XtX, Xty);
}

export function roundJs(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

export function round250(val: number): number {
  return roundJs(val / 250.0) * 250.0;
}

export function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function median(v: number[]): number {
  if (v.length === 0) return 0.0;
  const s = v.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[Math.floor(n / 2)]! : (s[n / 2 - 1]! + s[n / 2]!) / 2.0;
}

export function quantileSorted(s: number[], q: number): number {
  if (s.length === 0) return 0.0;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[pos]!;
  return s[lo]! * (hi - pos) + s[hi]! * (pos - lo);
}

export function huberIrls(
  X: number[][],
  y: number[],
  delta: number = 0.75,
  iters: number = 20,
): number[] {
  let beta = wls(X, y);
  for (let iter = 0; iter < iters; iter++) {
    const r = X.map((xi, i) => y[i]! - dot(xi, beta));
    const med = median(r);
    const mad = median(r.map((v) => Math.abs(v - med)));
    const sigma = Math.max(1.4826 * mad, 1e-9);
    const thr = delta * sigma;
    const w = r.map((ri) => (Math.abs(ri) <= thr ? 1.0 : thr / Math.abs(ri)));
    beta = wls(X, y, w);
  }
  return beta;
}

export function sigmoid(x: number): number {
  if (x > 35) return 1.0 - 1e-15;
  if (x < -35) return 1e-15;
  return 1.0 / (1.0 + Math.exp(-x));
}

export function weightedLogisticIrls(
  X: number[][],
  y: number[],
  weights: number[],
  lam: number = 0.5,
  iters: number = 12,
): number[] {
  const p = X[0]!.length;
  const n = X.length;
  let beta = new Array(p).fill(0.0);
  let sumW = 0.0;
  let sumWy = 0.0;
  for (let i = 0; i < n; i++) {
    sumW += weights[i]!;
    sumWy += weights[i]! * y[i]!;
  }
  const yMean = Math.max(1e-4, Math.min(1.0 - 1e-4, sumWy / Math.max(1e-6, sumW)));
  beta[0] = Math.log(yMean / (1.0 - yMean));
  for (let iter = 0; iter < iters; iter++) {
    const eta = X.map((xi) => dot(xi, beta));
    const mu = eta.map((e) => sigmoid(e));
    const W = mu.map((m, i) => Math.max(1e-6, weights[i]! * m * (1.0 - m)));
    const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0.0));
    const Xtz = new Array(p).fill(0.0);
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      const yi = y[i]!;
      const m = mu[i]!;
      const w = weights[i]!;
      const wi = W[i]!;
      const num = wi * dot(xi, beta) + w * (yi - m);
      for (let a = 0; a < p; a++) {
        Xtz[a]! += xi[a]! * num;
        for (let b = 0; b < p; b++) {
          XtX[a]![b]! += wi * xi[a]! * xi[b]!;
        }
      }
    }
    for (let a = 1; a < p; a++) {
      XtX[a]![a]! += lam;
    }
    beta = solveLinear(XtX, Xtz);
  }
  return beta;
}

export function brierScore(labels: number[], scores: number[]): number {
  if (labels.length === 0) return 0.0;
  let tot = 0.0;
  for (let i = 0; i < labels.length; i++) {
    tot += (scores[i]! - labels[i]!) ** 2;
  }
  return tot / labels.length;
}

export function accScore(labels: number[], scores: number[]): number {
  if (labels.length === 0) return 0.0;
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    if ((scores[i]! >= 0.5 ? 1 : 0) === labels[i]!) {
      count++;
    }
  }
  return count / labels.length;
}

export function logLoss(labels: number[], scores: number[]): number {
  if (labels.length === 0) return 0.0;
  let tot = 0.0;
  for (let i = 0; i < labels.length; i++) {
    const s = clip(scores[i]!, 1e-6, 1.0 - 1e-6);
    const l = labels[i]!;
    tot += -(l * Math.log(s) + (1.0 - l) * Math.log(1.0 - s));
  }
  return tot / labels.length;
}

export class Mulberry32 {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  }
}

export function ridgeFit(X: number[][], y: number[], lam: number, w?: number[]): number[] {
  const p = X[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0.0));
  const Xty: number[] = new Array(p).fill(0.0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    const yi = y[i]!;
    const wi = w === undefined ? 1.0 : w[i]!;
    for (let a = 0; a < p; a++) {
      Xty[a]! += wi * xi[a]! * yi;
      for (let b = 0; b < p; b++) {
        XtX[a]![b]! += wi * xi[a]! * xi[b]!;
      }
    }
  }
  for (let a = 1; a < p; a++) {
    XtX[a]![a]! += lam;
  }
  return solveLinear(XtX, Xty);
}

function computeRanks(vals: number[]): number[] {
  const order = Array.from({ length: vals.length }, (_, i) => i).sort(
    (a, b) => vals[a]! - vals[b]!,
  );
  const r = new Array<number>(vals.length).fill(0.0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && vals[order[j + 1]!] === vals[order[i]!]) {
      j++;
    }
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      r[order[k]!] = avg;
    }
    i = j + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number {
  if (a.length === 0) return 0.0;
  const ra = computeRanks(a);
  const rb = computeRanks(b);
  const n = a.length;
  let sa = 0.0;
  let sb = 0.0;
  for (let i = 0; i < n; i++) {
    sa += ra[i]!;
    sb += rb[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0.0;
  let denA = 0.0;
  let denB = 0.0;
  for (let i = 0; i < n; i++) {
    const da = ra[i]! - ma;
    const db = rb[i]! - mb;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den !== 0.0 ? num / den : 0.0;
}

export function ndcgTop20(actualLn: number[], pred: number[]): number {
  const n = pred.length;
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => pred[b]! - pred[a]! || a - b)
    .slice(0, 20);
  const ideal = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => actualLn[b]! - actualLn[a]! || a - b)
    .slice(0, 20);

  function dcg(idxs: number[]): number {
    let s = 0.0;
    for (let r = 0; r < idxs.length; r++) {
      s += actualLn[idxs[r]!]! / Math.log2(r + 2);
    }
    return s;
  }

  const d = dcg(order);
  const id = dcg(ideal);
  return id !== 0.0 ? d / id : 0.0;
}

// Backward-compatibility statistical helpers
export function rmsle(pairs: [number, number][]): number {
  if (pairs.length === 0) return 0.0;
  let sumSq = 0.0;
  for (const [y, yh] of pairs) {
    sumSq += (yh - y) ** 2;
  }
  return Math.sqrt(sumSq / pairs.length);
}

export function maeLog(pairs: [number, number][]): number {
  if (pairs.length === 0) return 0.0;
  let sumAbs = 0.0;
  for (const [y, yh] of pairs) {
    sumAbs += Math.abs(yh - y);
  }
  return sumAbs / pairs.length;
}

export function medape(pairs: [number, number][]): number {
  if (pairs.length === 0) return 0.0;
  const apes = pairs
    .map(([y, yh]) => Math.abs(Math.exp(yh) - Math.exp(y)) / Math.exp(y))
    .sort((a, b) => a - b);
  const n = apes.length;
  const m = Math.floor(n / 2);
  return n % 2 === 1 ? apes[m]! : (apes[m - 1]! + apes[m]!) / 2;
}

export function aucScore(labels: number[], scores: number[]): number {
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 1) pos.push(scores[i]!);
    else if (labels[i] === 0) neg.push(scores[i]!);
  }
  if (pos.length === 0 || neg.length === 0) {
    return 0.5;
  }
  let wins = 0.0;
  for (const ps of pos) {
    for (const ns of neg) {
      if (ps > ns) wins += 1.0;
      else if (ps === ns) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}
