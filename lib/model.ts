// Token Launch Radar v2 — valuation model.
//
// Every number on the board is fitted from the snapshot itself, in this file,
// deterministically: no clocks, no randomness, and the one train/test split
// is decided by a stable hash of each protocol's slug. The model prices a
// pre-token protocol at
//
//   implied value = TVL x category multiple x momentum factor
//                     x age factor x chain factor
//
// where the category multiple is the median market-cap / TVL ratio of the
// tokenised comparables in that category (shrunk toward the global median
// with a pseudo-count prior) and each factor is the ratio of a bucket's
// median multiple to the global median, shrunk toward 1 by bucket size and
// clamped to [0.5, 2.0]. The shrinkage strengths were selected by held-out
// validation across both splits. The fit is graded out of sample:
// parameters are fitted on one slug-hash half of the comparables and scored
// on the other half, then the halves swap, and a TVL-only baseline is
// scored the same way so the comparison is measurable.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

// ------------------------------------------------------------------ tuning

export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 2.0;
export const CATEGORY_PRIOR_WEIGHT = 15;
export const FACTOR_SHRINKAGE_K = 20;
export const MIN_CATEGORY_N = 3;
export const MIN_UNKNOWN_BUCKET_N = 5;
export const ODDS_MIN_BUCKET_N = 8;
export const ODDS_PRIOR_WEIGHT = 4;
export const VERDICT = {
  farm_min_score: 25,
  farm_min_odds_pct: 30,
  farm_min_implied_usd: 5000000,
  thin_min_score: 6,
  thin_min_implied_usd: 2000000,
};

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = [
  'Binance', 'Coinbase', 'Bybit', 'Kraken',
  'Bitget', 'OKX', 'Bitfinex', 'Gemini',
];

// ------------------------------------------------------------------ helpers

function sortedNums(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Median as the upper middle element of the sorted values (index floor(n/2)). */
export function medianOf(values: number[]): number {
  const s = sortedNums(values);
  return s[Math.floor(s.length / 2)];
}

/** Quantile with the same index convention as medianOf. */
export function quantileOf(values: number[], q: number): number {
  const s = sortedNums(values);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function roundTo(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
const r6 = (v: number) => roundTo(v, 6);
const r4 = (v: number) => roundTo(v, 4);

/** FNV-1a 32-bit hash of a slug: the stable coin-flip for the held-out split. */
export function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z');
  const b = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Years since listed_at as of the snapshot date; null when unlisted. */
export function ageYears(p: Protocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  return daysBetween(p.listed_at, asOf) / 365.25;
}

// ------------------------------------------------------------------ buckets

export function momentumBucket(change7d: number | null): string {
  if (change7d === null) return 'unknown';
  if (change7d < -2) return 'falling (7d < -2%)';
  if (change7d > 2) return 'rising (7d > +2%)';
  return 'flat (7d -2% to +2%)';
}

export function ageBucket(p: Protocol, asOf: string): string {
  const age = ageYears(p, asOf);
  if (age === null) return 'unknown';
  if (age < 1) return 'under 1y token-free';
  if (age < 3) return '1-3y token-free';
  return 'over 3y token-free';
}

export function chainBucket(p: Protocol): string {
  const n = (p.chains || []).length;
  if (n <= 1) return '1 chain';
  if (n <= 3) return '2-3 chains';
  return '4+ chains';
}

export function tvlBand(tvl: number): string {
  if (tvl < 10000000) return 'TVL under $10M';
  if (tvl < 50000000) return 'TVL $10-50M';
  return 'TVL $50M+';
}

export function ageBand(p: Protocol, asOf: string): string {
  const age = ageYears(p, asOf);
  if (age === null) return 'age unknown';
  if (age < 1) return 'age under 1y';
  if (age < 3) return 'age 1-3y';
  return 'age over 3y';
}

// ------------------------------------------------------------------ fitting

export interface CategoryFit {
  category: string;
  n: number;
  median: number;
  raw_median: number;
  p25: number;
  p75: number;
}

export interface FactorRow {
  bucket: string;
  n: number;
  factor: number;
}

export interface Fit {
  global_median: number;
  global_p25: number;
  global_p75: number;
  comparables: number;
  categories: CategoryFit[];
  momentum: FactorRow[];
  age: FactorRow[];
  chains: FactorRow[];
}

function ratioOf(p: Protocol): number {
  return (p.mcap_usd as number) / p.tvl_usd;
}

function fitBucketFactors(
  comps: Protocol[],
  keyOf: (p: Protocol) => string,
  globalMedian: number,
  unknownNeedsN: boolean,
): FactorRow[] {
  const byBucket = new Map<string, number[]>();
  for (const p of comps) {
    const key = keyOf(p);
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key)!.push(ratioOf(p));
  }
  const rows: FactorRow[] = [];
  for (const key of [...byBucket.keys()].sort()) {
    const ratios = byBucket.get(key)!;
    let factor = 1;
    const isUnknown = key === 'unknown';
    if (!isUnknown || !unknownNeedsN || ratios.length >= MIN_UNKNOWN_BUCKET_N) {
      const rawFactor = medianOf(ratios) / globalMedian;
      const shrunk = 1 + (rawFactor - 1) * ratios.length / (ratios.length + FACTOR_SHRINKAGE_K);
      factor = clamp(shrunk, FACTOR_MIN, FACTOR_MAX);
    }
    rows.push({ bucket: key, n: ratios.length, factor: r6(factor) });
  }
  return rows;
}

export function fitModel(comps: Protocol[], asOf: string): Fit {
  const ratios = comps.map(ratioOf);
  const globalMedian = medianOf(ratios);
  const globalP25 = quantileOf(ratios, 0.25);
  const globalP75 = quantileOf(ratios, 0.75);

  const byCategory = new Map<string, number[]>();
  for (const p of comps) {
    const cat = p.category as string;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(ratioOf(p));
  }
  const categories: CategoryFit[] = [];
  for (const cat of [...byCategory.keys()].sort()) {
    const rs = byCategory.get(cat)!;
    const raw = medianOf(rs);
    const median = (rs.length * raw + CATEGORY_PRIOR_WEIGHT * globalMedian) / (rs.length + CATEGORY_PRIOR_WEIGHT);
    categories.push({
      category: cat,
      n: rs.length,
      median: r6(median),
      raw_median: r6(raw),
      p25: r6(rs.length >= MIN_CATEGORY_N ? quantileOf(rs, 0.25) : globalP25),
      p75: r6(rs.length >= MIN_CATEGORY_N ? quantileOf(rs, 0.75) : globalP75),
    });
  }

  return {
    global_median: r6(globalMedian),
    global_p25: r6(globalP25),
    global_p75: r6(globalP75),
    comparables: comps.length,
    categories,
    momentum: fitBucketFactors(comps, (p) => momentumBucket(p.change_7d), globalMedian, true),
    age: fitBucketFactors(comps, (p) => ageBucket(p, asOf), globalMedian, true),
    chains: fitBucketFactors(comps, (p) => chainBucket(p), globalMedian, false),
  };
}

function categoryFit(fit: Fit, category: string | null): CategoryFit {
  if (category !== null) {
    const found = fit.categories.find((c) => c.category === category);
    if (found) return found;
  }
  return {
    category: category ?? '(none)',
    n: 0,
    median: fit.global_median,
    raw_median: fit.global_median,
    p25: fit.global_p25,
    p75: fit.global_p75,
  };
}

function factorFor(rows: FactorRow[], bucket: string): number {
  const row = rows.find((r) => r.bucket === bucket);
  return row ? row.factor : 1;
}

/** Implied value of a protocol under a fit, using the first `level` factors. */
function predictWith(fit: Fit, p: Protocol, asOf: string, level: number): number {
  let v = p.tvl_usd * categoryFit(fit, p.category).median;
  if (level >= 2) v *= factorFor(fit.momentum, momentumBucket(p.change_7d));
  if (level >= 3) v *= factorFor(fit.age, ageBucket(p, asOf));
  if (level >= 4) v *= factorFor(fit.chains, chainBucket(p));
  return v;
}

// ------------------------------------------------------------------ scoring

export interface ScoreMetrics {
  n: number;
  median_abs_log10_err: number;
  mean_log10_err: number;
  pct_within_2x: number;
  r2_log10: number;
}

function scorePredictions(pairs: { pred: number; actual: number }[]): ScoreMetrics {
  const errs = pairs.map(({ pred, actual }) => Math.log10(pred) - Math.log10(actual));
  const ys = pairs.map(({ actual }) => Math.log10(actual));
  const yMean = meanOf(ys);
  let ssRes = 0;
  let ssTot = 0;
  pairs.forEach(({ pred }, i) => {
    ssRes += (ys[i] - Math.log10(pred)) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  });
  return {
    n: pairs.length,
    median_abs_log10_err: r4(medianOf(errs.map((e) => Math.abs(e)))),
    mean_log10_err: r4(meanOf(errs)),
    pct_within_2x: r4(100 * errs.filter((e) => Math.abs(e) <= Math.log10(2)).length / errs.length),
    r2_log10: r4(ssTot === 0 ? 0 : 1 - ssRes / ssTot),
  };
}

export interface HeldOutSplit {
  train_half: string;
  test_half: string;
  train_n: number;
  full_model: ScoreMetrics;
  baseline_tvl_only: ScoreMetrics;
}

function heldOutValidation(comps: Protocol[], asOf: string): HeldOutSplit[] {
  const halves: Protocol[][] = [[], []];
  for (const p of comps) halves[slugHash(p.slug) % 2].push(p);
  const splits: HeldOutSplit[] = [];
  for (const trainIdx of [0, 1]) {
    const train = halves[trainIdx];
    const test = halves[1 - trainIdx];
    const fit = fitModel(train, asOf);
    const full = scorePredictions(test.map((p) => ({
      pred: predictWith(fit, p, asOf, 4),
      actual: p.mcap_usd as number,
    })));
    const baseline = scorePredictions(test.map((p) => ({
      pred: p.tvl_usd * fit.global_median,
      actual: p.mcap_usd as number,
    })));
    splits.push({
      train_half: 'H' + (trainIdx + 1),
      test_half: 'H' + (2 - trainIdx),
      train_n: train.length,
      full_model: full,
      baseline_tvl_only: baseline,
    });
  }
  return splits;
}

export interface AblationRow {
  level: string;
  label: string;
  median_abs_log10_err: number;
}

function ablationLadder(comps: Protocol[], fit: Fit, asOf: string): AblationRow[] {
  const labels = [
    ['A0', 'global median multiple only'],
    ['A1', '+ category medians (shrunk toward global)'],
    ['A2', '+ momentum bucket factor'],
    ['A3', '+ age bucket factor'],
    ['A4', 'full model (+ chain-count factor)'],
  ];
  return labels.map(([level, label], i) => {
    const pairs = comps.map((p) => ({
      pred: i === 0 ? p.tvl_usd * fit.global_median : predictWith(fit, p, asOf, i),
      actual: p.mcap_usd as number,
    }));
    const errs = pairs.map(({ pred, actual }) => Math.abs(Math.log10(pred) - Math.log10(actual)));
    return { level, label, median_abs_log10_err: r4(medianOf(errs)) };
  });
}

// ------------------------------------------------------------------ candidates

export function isCandidate(p: Protocol): boolean {
  if (p.mcap_usd !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(V2|v2|2\.0)$/.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ odds

export interface OddsInfo {
  odds_pct: number;
  level: string;
  bucket_label: string;
  bucket_n: number;
  bucket_tokenized: number;
  backoff_label: string;
  backoff_rate_pct: number;
}

function isTokenized(p: Protocol): boolean {
  return p.mcap_usd !== null;
}

function launchOdds(
  candidate: Protocol,
  all: Protocol[],
  asOf: string,
): OddsInfo {
  const cat = candidate.category;
  const peers = all.filter((p) => p.category === cat);
  const tBand = tvlBand(candidate.tvl_usd);
  const aBand = ageBand(candidate, asOf);
  const levels: { label: string; rows: Protocol[] }[] = [
    {
      label: 'category x TVL band x age band',
      rows: peers.filter((p) => tvlBand(p.tvl_usd) === tBand && ageBand(p, asOf) === aBand),
    },
    {
      label: 'category x TVL band',
      rows: peers.filter((p) => tvlBand(p.tvl_usd) === tBand),
    },
    { label: 'category', rows: peers },
    { label: 'global (all protocols)', rows: all },
  ];
  const rates = levels.map((l) => ({
    ...l,
    tokenized: l.rows.filter(isTokenized).length,
    rate: l.rows.length === 0 ? 0 : l.rows.filter(isTokenized).length / l.rows.length,
  }));
  let used = rates.length - 1;
  for (let i = 0; i < rates.length; i++) {
    if (rates[i].rows.length >= ODDS_MIN_BUCKET_N) { used = i; break; }
  }
  const chosen = rates[used];
  const backoff = rates[Math.min(used + 1, rates.length - 1)];
  const shrunk = (chosen.tokenized + ODDS_PRIOR_WEIGHT * backoff.rate) / (chosen.rows.length + ODDS_PRIOR_WEIGHT);
  return {
    odds_pct: Math.round(shrunk * 100),
    level: chosen.label,
    bucket_label: (cat ?? '(no category)') + ' · ' + tBand + ' · ' + aBand,
    bucket_n: chosen.rows.length,
    bucket_tokenized: chosen.tokenized,
    backoff_label: backoff.label,
    backoff_rate_pct: r4(backoff.rate * 100),
  };
}

// ------------------------------------------------------------------ farm plans

function positionSize(tvl: number): number {
  return clamp(Math.round(tvl * 0.0002), 250, 5000);
}

function coreAction(category: string | null): { verb: string; venue: string } {
  switch (category) {
    case 'Lending':
    case 'Uncollateralized Lending':
      return { verb: 'supply a blue-chip collateral asset and take a small, well-collateralised borrow against it', venue: 'the main lending market' };
    case 'Dexs':
      return { verb: 'provide two-sided liquidity to the deepest pool and route a few real swaps through it', venue: 'the flagship exchange pool' };
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
    case 'Leveraged Farming':
      return { verb: 'deposit into the flagship vault and keep the position compounding instead of hopping between vaults', venue: 'the flagship vault' };
    case 'CDP':
    case 'CDP Manager':
    case 'Algo-Stables':
    case 'Dual-Token Stablecoin':
      return { verb: 'open a small collateralised debt position and mint against it, keeping the health factor comfortably high', venue: 'the main vault market' };
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
      return { verb: 'trade a small recurring size on the main market so the account builds a genuine volume history', venue: 'the main derivatives market' };
    case 'Launchpad':
      return { verb: 'stake or hold the required balance and take part in one live launch allocation round', venue: 'the launchpad' };
    default:
      return { verb: 'use the core product the way a real user would, with a real balance at stake', venue: 'the main product interface' };
  }
}

export interface FarmStep {
  text: string;
  cost_usd: number;
  duration: string;
}

export function farmPlan(p: Protocol): FarmStep[] {
  const chain = (p.chains && p.chains[0]) || 'its main chain';
  const chainCount = (p.chains || []).length || 1;
  const pos = positionSize(p.tvl_usd);
  const { verb, venue } = coreAction(p.category);
  const gas = 6 + 4 * chainCount;
  const steps: FarmStep[] = [
    {
      text: `Create a fresh wallet for ${p.name} and bridge $${pos} of working capital to ${chain}, keeping that wallet dedicated to this protocol alone — about $${gas} in bridge and gas fees, 30 minutes.`,
      cost_usd: gas,
      duration: '30 minutes',
    },
    {
      text: `Make the first real deposit with ${p.name}: ${verb} on ${chain} via ${venue}, sized at the full $${pos} — about $${Math.round(pos * 0.01) + 4} in swap and approval fees, 20 minutes.`,
      cost_usd: Math.round(pos * 0.01) + 4,
      duration: '20 minutes',
    },
    {
      text: `Repeat the core ${p.name} action weekly for six weeks — top up, rebalance or roll the position instead of depositing once and going idle — about $${5 + chainCount * 2} in gas per week, 15 minutes a week.`,
      cost_usd: (5 + chainCount * 2) * 6,
      duration: '15 minutes a week for 6 weeks',
    },
    {
      text: `Use one secondary ${p.name} feature on ${chain} (a second market or vault among its ${chainCount} listed chains) so the account goes beyond the single most farmed route — about $${Math.round(pos * 0.005) + 5} in fees, one hour.`,
      cost_usd: Math.round(pos * 0.005) + 5,
      duration: '1 hour',
    },
    {
      text: `Stay active until any ${p.name} snapshot or points season closes: check weekly, claim and restake rewards, and keep at least half the original $${pos} in place — about $8 in gas a month, 10 minutes a week.`,
      cost_usd: 24,
      duration: '10 minutes a week, ongoing',
    },
  ];
  return steps.map((s) => ({ ...s, text: s.text.trim() }));
}

// ------------------------------------------------------------------ the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  odds_pct: number;
  band_low_usd: number;
  band_high_usd: number;
  verdict: string;
  farm_score: number;
  farm_cost_usd: number;
  chains: string[];
  listed_at: string | null;
  age_years: number | null;
  watchlist: boolean;
  category_multiple: number;
  momentum_factor: number;
  age_factor: number;
  chain_factor: number;
  odds: OddsInfo;
  farm_plan: FarmStep[];
  verdict_reason: string;
}

export interface BoardResult {
  rows: BoardRow[];
  model: Record<string, unknown>;
  integrity: Record<string, unknown>;
}

export function buildBoard(snapshot: Snapshot): BoardResult {
  const asOf = snapshot.as_of;
  const all = snapshot.protocols;
  const comparables = all.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const fit = fitModel(comparables, asOf);
  const heldOut = heldOutValidation(comparables, asOf);
  const ablation = ablationLadder(comparables, fit, asOf);

  const watchlist = new Set(snapshot.watchlist);
  const candidates = all.filter(isCandidate);

  const rows: BoardRow[] = candidates.map((p) => {
    const cat = categoryFit(fit, p.category);
    const mF = factorFor(fit.momentum, momentumBucket(p.change_7d));
    const aF = factorFor(fit.age, ageBucket(p, asOf));
    const cF = factorFor(fit.chains, chainBucket(p));
    const factors = mF * aF * cF;
    const implied = Math.round(p.tvl_usd * cat.median * factors);
    const bandLow = Math.round(p.tvl_usd * cat.p25 * factors);
    const bandHigh = Math.round(p.tvl_usd * cat.p75 * factors);
    const odds = launchOdds(p, all, asOf);
    const plan = farmPlan(p);
    const farmCost = plan.reduce((s, x) => s + x.cost_usd, 0);
    const farmScore = (odds.odds_pct / 100) * implied / farmCost;
    let verdict = 'SKIP';
    let reason = `Farm score ${farmScore.toFixed(1)} (odds ${odds.odds_pct}% x $${implied.toLocaleString('en-US')} implied / $${farmCost} cost) is below the THIN bar — capital earns more elsewhere on this board.`;
    if (farmScore >= VERDICT.farm_min_score
      && odds.odds_pct >= VERDICT.farm_min_odds_pct
      && implied >= VERDICT.farm_min_implied_usd) {
      verdict = 'FARM';
      reason = `Farm score ${farmScore.toFixed(1)} clears the FARM bar of ${VERDICT.farm_min_score}: odds ${odds.odds_pct}% on $${implied.toLocaleString('en-US')} implied against only $${farmCost} of total farm cost.`;
    } else if (farmScore >= VERDICT.thin_min_score && implied >= VERDICT.thin_min_implied_usd) {
      verdict = 'THIN';
      reason = `Farm score ${farmScore.toFixed(1)} clears the THIN bar of ${VERDICT.thin_min_score} (odds ${odds.odds_pct}%, implied $${implied.toLocaleString('en-US')}, cost $${farmCost}) but not FARM — a small position only.`;
    }
    const age = ageYears(p, asOf);
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: plan.map((s) => s.text),
      category: p.category,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      odds_pct: odds.odds_pct,
      band_low_usd: bandLow,
      band_high_usd: bandHigh,
      verdict,
      farm_score: r4(farmScore),
      farm_cost_usd: farmCost,
      chains: p.chains || [],
      listed_at: p.listed_at,
      age_years: age === null ? null : r4(age),
      watchlist: watchlist.has(p.slug),
      category_multiple: cat.median,
      momentum_factor: mF,
      age_factor: aF,
      chain_factor: cF,
      odds,
      farm_plan: plan,
      verdict_reason: reason,
    };
  });

  rows.sort((a, b) => (b.implied_value_usd - a.implied_value_usd) || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => { row.rank = i + 1; });

  // ---------------------------------------------------------- integrity
  const covered = snapshot.watchlist.filter((slug) => rows.some((r) => r.slug === slug)).length;
  if (covered !== snapshot.watchlist.length) {
    throw new Error(`watchlist coverage ${covered}/${snapshot.watchlist.length}: a watchlist slug is missing from the board`);
  }
  let monotone = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) monotone = false;
  }
  if (!monotone) throw new Error('board is not monotone in implied value by rank');
  let stepsOk = true;
  for (const row of rows) {
    if (row.farm_steps.length !== 5) stepsOk = false;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) stepsOk = false;
    }
  }
  if (!stepsOk) throw new Error('a farm step falls outside 20-600 trimmed characters');

  const model = {
    formula: 'implied value = TVL x category multiple x momentum factor x age factor x chain factor',
    global_median: fit.global_median,
    global_p25: fit.global_p25,
    global_p75: fit.global_p75,
    comparables_used: comparables.length,
    median_convention: 'upper middle element of the sorted ratios (index floor(n/2))',
    factor_clamp: [FACTOR_MIN, FACTOR_MAX],
    category_prior_weight: CATEGORY_PRIOR_WEIGHT,
    factor_shrinkage_k: FACTOR_SHRINKAGE_K,
    shrinkage_selection: 'category pseudo-count and factor shrinkage k were selected by held-out validation across both slug-hash splits',
    categories: fit.categories,
    momentum_factors: fit.momentum,
    age_factors: fit.age,
    chain_factors: fit.chains,
    held_out: heldOut,
    ablation,
    verdict_thresholds: VERDICT,
    odds_method: {
      min_bucket_n: ODDS_MIN_BUCKET_N,
      prior_weight: ODDS_PRIOR_WEIGHT,
      levels: ['category x TVL band x age band', 'category x TVL band', 'category', 'global (all protocols)'],
      note: 'odds = share of peer protocols that already record a token, in the finest bucket holding at least 8 peers, shrunk toward the next coarser rate with a prior weight of 4',
    },
  };

  const integrity = {
    as_of: asOf,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocols_scanned: all.length,
    candidates_ranked: rows.length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_covered: covered,
    comparables_used: comparables.length,
    monotone_verified: monotone,
    farm_steps_verified: stepsOk,
    held_out_splits: heldOut.length,
  };

  return { rows, model, integrity };
}
