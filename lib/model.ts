// Token Launch Radar — valuation model.
// Ranks pre-token protocols by the market value a token launch would imply,
// using the market-cap / TVL ratios of already-tokenised comparables.

export const MOMENTUM_PER_PCT = 0.006;
export const MOMENTUM_MIN = 0.7;
export const MOMENTUM_MAX = 1.4;
export const AGE_PER_YEAR = 0.05;
export const AGE_MAX_YEARS = 6;
export const CHAIN_PER_EXTRA = 0.03;
export const CHAIN_MAX_EXTRA = 5;
export const MIN_CATEGORY_COMPARABLES = 3;

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

interface Stats {
  median: number;
  p25: number;
  p75: number;
  n: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function quantileStats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const at = (q: number) =>
    sorted[clamp(Math.floor(q * n), 0, n - 1)];
  return { median, p25: at(0.25), p75: at(0.75), n };
}

function yearsBetween(from: string, to: string): number {
  const ms = Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z');
  const days = Math.floor(ms / 86400000);
  return days / 365.25;
}

export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return clamp(1 + change7d * MOMENTUM_PER_PCT, MOMENTUM_MIN, MOMENTUM_MAX);
}

export function ageFactor(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 1;
  return 1 + AGE_PER_YEAR * Math.min(yearsBetween(listedAt, asOf), AGE_MAX_YEARS);
}

export function chainsFactor(chainCount: number): number {
  const extra = clamp(chainCount - 1, 0, CHAIN_MAX_EXTRA);
  return 1 + CHAIN_PER_EXTRA * extra;
}

function sizeTier(tvl: number): string {
  if (tvl >= 1_000_000_000) return '$1,000–$5,000';
  if (tvl >= 100_000_000) return '$500–$2,500';
  if (tvl >= 10_000_000) return '$250–$1,000';
  return '$100–$500';
}

// ---------------------------------------------------------------------------
// Farm playbooks: five concrete steps per category group. Slots: {name},
// {chain} = first chain, {chains} = chain count, {size} = position-size tier.
// Every step states a concrete action plus a cost or a duration.
// ---------------------------------------------------------------------------

type Playbook = [string, string, string, string, string];

const PLAYBOOKS: Record<string, Playbook> = {
  lending: [
    'Open {name} on {chain} and supply a blue-chip asset (ETH or a major stablecoin) in a {size} position; the one-time approval plus supply costs about $3–$8 in gas and takes 10 minutes.',
    'Borrow a small amount against your supply on {name} — keep utilisation under 40% of your collateral — and repay it within the same week; one borrow/repay cycle costs about $5 in gas.',
    'Repeat the supply-and-borrow loop on {name} every week for 6–10 weeks so your wallet shows a steady history instead of a single burst; budget about $2–$4 in gas per week.',
    'Use every market {name} lists on {chain}: supply at least two different assets and borrow at least two different assets over the season, roughly 20 minutes of work per market.',
    'Keep the {size} position open and untouched through any snapshot rumours; check your health factor on {name} weekly for 2 minutes so you are never liquidated before a launch.',
  ],
  dexs: [
    'Swap on {name} on {chain} at least twice a week, rotating pairs each time; a {size} weekly volume target is realistic and each swap costs about $1–$3 in gas and slippage.',
    'Add a {size} liquidity position on {name} in a major pair and leave it deployed for at least 8 weeks; entering and exiting the position costs about $4–$7 in gas total.',
    'Trade on each of the {chains} chain deployment(s) of {name} at least once a month so your wallet is active everywhere it operates; bridging a small float costs about $5 per move.',
    'Use the advanced order types {name} offers (limit orders or TWAP) for at least five orders over the season; each order takes about 5 minutes to place and monitor.',
    'Keep swapping small amounts on {name} even in quiet weeks — consistency over 6–10 weeks matters more than one huge day; cap total gas spend at about $10 per month.',
  ],
  liquidStaking: [
    'Stake a {size} position through {name} on {chain} and hold the liquid staking token you receive; the stake transaction costs about $3–$6 in gas and takes 10 minutes.',
    'Use the {name} staking token as collateral or liquidity somewhere it is accepted at least once, so you are a real user of the token and not just a holder; allow 20 minutes for setup.',
    'Add to your {name} stake in at least four separate tranches spread over 6–10 weeks instead of one lump sum; each top-up costs about $3 in gas.',
    'Run one full unstake-and-restake cycle on {name} to learn the unbonding flow before any launch; note the unbonding period in days and keep funds you need liquid elsewhere.',
    'Claim and restake your {name} rewards monthly so compounding is visible on-chain; each claim costs about $2 in gas and takes 5 minutes.',
  ],
  bridge: [
    'Bridge a {size} amount through {name} from {chain} to a second chain at least twice a month; each crossing costs about $2–$6 in fees and takes 10–30 minutes to settle.',
    'Use {name} in both directions — bridge out and bridge back — at least three times over the season so your routes look like genuine usage, about $4 in fees per round trip.',
    'Work through the distinct routes {name} supports — it spans {chains} chain(s) — with one small transfer on each route you can fund; a full sweep takes about an hour and roughly $15 in total fees.',
    'Bridge on different days of the week and at different times on {name} for 6–10 weeks; organic timing patterns take 5 minutes per transfer to maintain.',
    'Keep a small balance parked on the destination chain after each {name} transfer for at least a week instead of bridging everything straight back; this costs nothing but patience.',
  ],
  yield: [
    'Deposit a {size} position into a flagship vault on {name} on {chain} and leave it for at least 8 weeks; the deposit costs about $4–$8 in gas and takes 10 minutes.',
    'Spread a second, smaller deposit across another {name} vault or strategy so you hold more than one position; allow 20 minutes and about $5 in gas for the extra deposit.',
    'Harvest or compound your {name} yield at least once a month rather than letting it sit idle; each compound costs about $2–$3 in gas and takes 5 minutes.',
    'Rotate a portion of your capital between {name} strategies once per quarter as rates change, and record each move; a rotation takes about 15 minutes and $6 in gas.',
    'Withdraw a small slice (about 10%) from {name} once mid-season and redeposit it a week later, proving an active full lifecycle; the round trip costs about $5 in gas.',
  ],
  derivatives: [
    'Open a small perpetual or options position on {name} on {chain} with a {size} margin and close it the same day; your first trade takes about 20 minutes and $3 in fees.',
    'Trade {name} at least twice a week for 6–10 weeks, alternating long and short so your history is two-sided; keep each position small and budget about $10 a month in fees.',
    'Post margin in more than one collateral type {name} accepts, and move margin between sub-accounts once; setup takes about 15 minutes and costs about $2 in gas.',
    'Place at least five resting limit orders on {name} that actually fill over the season, not only market orders; each order takes about 5 minutes to place and check.',
    'Withdraw a portion of your profits or margin from {name} once and deposit again a week later, completing the full account lifecycle; withdrawals settle in about 10–60 minutes.',
  ],
  cdp: [
    'Open a vault on {name} on {chain}: deposit collateral and mint a modest amount of its stablecoin against a {size} position; opening costs about $5–$9 in gas and 15 minutes.',
    'Keep your {name} vault collateral ratio comfortably above the liquidation line and check it weekly for 2 minutes; top up collateral once during a volatile week to show active management.',
    'Use the stablecoin you minted from {name} in one other venue (a swap or a deposit) and later buy it back to repay; the round trip takes about 20 minutes and $4 in gas.',
    'Repay part of your {name} debt at least twice over 6–10 weeks and mint again once, so the vault shows a real borrow-repay rhythm; each adjustment costs about $3 in gas.',
    'Close the season still holding an open, healthy {name} vault — do not fully exit before a launch snapshot; maintaining it costs only the weekly 2-minute check.',
  ],
  rwa: [
    'Complete onboarding and any KYC {name} requires on {chain} first — set aside about 30 minutes and have ID ready, since verified accounts are the ones a launch can reward.',
    'Make a first allocation of {size} into a flagship real-world asset product on {name}; funding the position usually settles within 1–3 business days.',
    'Hold the {name} position through at least two full yield or coupon distributions (typically 2–3 months) instead of exiting after the first payout.',
    'Add a second, smaller allocation on {name} in a different asset or maturity if one is offered, about 15 minutes of work once onboarding is done.',
    'Reinvest one distribution from {name} back into the platform rather than withdrawing it, and keep records of each statement; the reinvestment takes about 10 minutes.',
  ],
  restaking: [
    'Restake a {size} position through {name} on {chain} — either native ETH or a liquid staking token; the deposit costs about $4–$7 in gas and takes 15 minutes.',
    'Delegate or opt into at least one operator or service inside {name} rather than leaving the restake undelegated; choosing and delegating takes about 10 minutes.',
    'Add to your {name} restake in at least three separate tranches over 6–10 weeks so the position builds gradually; each top-up costs about $3 in gas.',
    'Claim restaking rewards or points statements on {name} whenever they drop, and restake the proceeds; a claim round costs about $2 in gas and 5 minutes.',
    'Keep the {name} position restaked through the full season — withdrawals usually have a multi-day unbonding queue, so plan liquidity at least 2 weeks ahead.',
  ],
  stakingPool: [
    'Stake a {size} position with {name} on {chain} and note the lock or unbonding terms before you commit; the stake costs about $3 in gas and takes 10 minutes.',
    'Pick a validator or pool inside {name} with a solid uptime record, and switch once mid-season if performance lags; a switch takes about 10 minutes.',
    'Top up your {name} stake at least three times over 6–10 weeks in separate transactions; each top-up costs about $2–$3 in gas.',
    'Claim staking rewards from {name} monthly and restake at least half of them so compounding shows on-chain; each claim takes about 5 minutes.',
    'Stay staked with {name} through any launch window — start the unbonding process only after you have confirmed no snapshot is pending, since exit queues run for days.',
  ],
  basisTrading: [
    'Open the core basis position on {name} on {chain} with a {size} allocation: hold the spot leg and the offsetting hedge exactly as the product structures it; setup takes about 25 minutes.',
    'Rebalance your {name} position whenever the dashboard flags drift, roughly once every 1–2 weeks; each rebalance takes about 10 minutes and a few dollars in fees.',
    'Add capital to {name} in at least three separate deposits over 6–10 weeks instead of one lump sum, so funding-rate regimes vary across your entries.',
    'Withdraw a small slice (about 10%) from {name} once to confirm the exit path and timings, then redeposit after a week; the test costs about $4 in fees.',
    'Track the funding or basis yield {name} reports weekly in a simple spreadsheet — 5 minutes a week — and stay in only while the net yield beats plain staking.',
  ],
  curators: [
    'Allocate a {size} position through a flagship vault or market curated on {name} on {chain}; the deposit costs about $4–$6 in gas and takes 10 minutes.',
    'Hold positions in at least two different {name} vaults or markets so your exposure is not a single bet; setting up the second position takes about 15 minutes.',
    'Review the curator updates {name} publishes and rebalance once when allocations shift materially; a rebalance takes about 10 minutes and $3 in gas.',
    'Keep the {name} allocation deployed for at least 8 weeks, checking the vault health and utilisation weekly in a 2-minute review.',
    'Withdraw about 10% from {name} once mid-season and redeposit it a week later to complete an active lifecycle; the round trip costs about $5 in gas.',
  ],
  cex: [
    'Create and fully verify an account with {name} — KYC usually takes about 20 minutes — and enable two-factor authentication before depositing anything.',
    'Deposit a {size} amount to {name} and make at least two spot trades a week for 6–10 weeks; small trades keep fees to roughly $5–$10 a month at typical tiers.',
    'Use more than one product on {name} — for example spot plus its earn or staking feature — with a small amount in each; setup takes about 15 minutes per product.',
    'Withdraw a portion of your funds from {name} to your own wallet once a month and deposit again later, proving a genuine two-way flow; each withdrawal costs a few dollars.',
    'Keep a modest balance on {name} through the season rather than emptying the account after each trade; check the account weekly for about 2 minutes.',
  ],
  chain: [
    'Bridge a {size} float onto the {name} network (starting from {chain} if needed) and keep it there for the season; the bridge costs about $3–$6 and settles in 10–30 minutes.',
    'Make at least three transactions a week on {name} — swaps, transfers or contract interactions — for 6–10 weeks; on-chain fees are usually under $1 per transaction.',
    'Use at least three different applications live on {name} (a swap venue, a lending market and one other), spending about 20 minutes exploring each.',
    'Hold a small balance of the gas asset and one other asset on {name} continuously, topping up monthly; a top-up bridge costs about $3 each time.',
    'If {name} runs quests, testnet or ecosystem campaigns, complete the current one end to end; most take about 30–45 minutes and a few dollars in fees.',
  ],
  launchpad: [
    'Register and complete any whitelist or KYC steps {name} runs on {chain} before the next sale opens; registration takes about 15 minutes and is often time-limited.',
    'Commit a {size} amount to at least one launch on {name} this season, even a small tier — participation history is what a launchpad can measure; funding settles in minutes.',
    'Stake or hold whatever participation asset {name} uses for tiering, if any, for at least 8 weeks; the stake transaction costs about $3 in gas.',
    'Claim and hold the tokens from your first {name} launch for at least a month instead of selling on day one; claiming costs about $2 in gas.',
    'Take part in a second {name} launch at least a few weeks after the first so your activity spans the season; each participation takes about 20 minutes end to end.',
  ],
  prediction: [
    'Fund a {size} account balance on {name} on {chain} and place your first position on a liquid market; the deposit and first trade take about 15 minutes.',
    'Trade at least five different markets on {name} over the season, sizing each position small; each trade takes about 5 minutes and market fees are usually under $1.',
    'Hold at least one {name} position through to settlement instead of always exiting early, so your history includes resolved markets; settlements pay out automatically.',
    'Provide liquidity or take the other side of thin markets on {name} where the interface allows it, for at least 4 weeks; check your exposure weekly for 5 minutes.',
    'Withdraw winnings or idle balance from {name} once and redeposit later in the season, completing the full cycle; a withdrawal settles in about 10–60 minutes.',
  ],
  payments: [
    'Sign up for {name} and complete identity verification — about 20 minutes — then order or activate its payment product if your region is supported.',
    'Route a {size} total volume of genuine everyday spending or payments through {name} spread over at least 8 weeks, not in a single day.',
    'Use {name} for at least three different payment types it supports (for example card spend, a transfer and a top-up), each taking only a few minutes.',
    'Hold a modest working balance with {name} through the season and top it up monthly rather than draining it to zero after every use.',
    'Refer or transact with at least one other real user of {name} if the product has a social or transfer feature; a first transfer takes about 5 minutes.',
  ],
  default: [
    'Create an account or wallet connection with {name} on {chain} and complete its core action once end to end; the first session takes about 20 minutes and a few dollars in fees.',
    'Commit a {size} position or balance to {name} and keep it active for at least 8 weeks, checking in weekly for about 5 minutes.',
    'Use a second feature of {name} beyond the headline one — most products have a secondary market, tier or setting; exploring it takes about 15 minutes.',
    'Return to {name} at least twice a month for 6–10 weeks with a real transaction each time, so activity is spread across the season; budget about $5 a month in fees.',
    'Withdraw a small amount from {name} once to verify the exit path, then redeposit it a week later; the round trip takes about 20 minutes in total.',
  ],
};

const CATEGORY_TO_PLAYBOOK: Record<string, string> = {
  'Lending': 'lending',
  'Dexs': 'dexs',
  'Liquid Staking': 'liquidStaking',
  'Bridge': 'bridge',
  'Cross Chain Bridge': 'bridge',
  'Canonical Bridge': 'bridge',
  'Yield': 'yield',
  'Yield Aggregator': 'yield',
  'Farm': 'yield',
  'Leveraged Farming': 'yield',
  'Derivatives': 'derivatives',
  'Options': 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  'CDP': 'cdp',
  'CDP Manager': 'cdp',
  'RWA': 'rwa',
  'Restaking': 'restaking',
  'Liquid Restaking': 'restaking',
  'Restaked BTC': 'restaking',
  'Anchor BTC': 'restaking',
  'Decentralized BTC': 'restaking',
  'Staking Pool': 'stakingPool',
  'Basis Trading': 'basisTrading',
  'Risk Curators': 'curators',
  'Onchain Capital Allocator': 'curators',
  'Collateral Management': 'curators',
  'Collateral Markets': 'curators',
  'CEX': 'cex',
  'CeDeFi': 'cex',
  'Chain': 'chain',
  'Launchpad': 'launchpad',
  'Prediction Market': 'prediction',
  'Payments': 'payments',
  'Crypto Card Issuer': 'payments',
};

function farmSteps(p: Protocol): string[] {
  const key = CATEGORY_TO_PLAYBOOK[p.category ?? ''] ?? 'default';
  const templates = PLAYBOOKS[key];
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const size = sizeTier(p.tvl_usd);
  return templates.map((t) =>
    t
      .replaceAll('{name}', p.name)
      .replaceAll('{chain}', chain)
      .replaceAll('{chains}', String(p.chains.length))
      .replaceAll('{size}', size)
      .trim(),
  );
}

// ---------------------------------------------------------------------------
// Board construction
// ---------------------------------------------------------------------------

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  tvl_usd: number;
  change_7d: number | null;
  chains_count: number;
  chains: string[];
  listed_at: string | null;
  multiple: number;
  band_low_usd: number;
  band_high_usd: number;
  verdict: string;
  watchlist: boolean;
  stats_source: string;
  stats_n: number;
  momentum: number;
  age_factor: number;
  chains_factor: number;
}

interface CandidateCalc {
  p: Protocol;
  multiple: number;
  bandLowMult: number;
  bandHighMult: number;
  momentum: number;
  age: number;
  chainsF: number;
  stats: Stats;
  statsSource: string;
  variants: number[];
  full: number;
  bandLow: number;
  bandHigh: number;
}

export function buildBoard(snapshot: Snapshot) {
  const { protocols, watchlist, as_of } = snapshot;
  const watch = new Set(watchlist);

  const comparables = protocols.filter(
    (p) => p.mcap_usd !== null && p.tvl_usd > 0,
  );
  const globalStats = quantileStats(
    comparables.map((p) => (p.mcap_usd as number) / p.tvl_usd),
  );

  const byCategory = new Map<string, number[]>();
  for (const p of comparables) {
    const cat = p.category ?? 'Uncategorised';
    const arr = byCategory.get(cat) ?? [];
    arr.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(cat, arr);
  }
  const categoryStats = new Map<string, Stats>();
  for (const [cat, vals] of byCategory) {
    categoryStats.set(cat, quantileStats(vals));
  }

  const statsFor = (p: Protocol): { stats: Stats; source: string } => {
    const cat = p.category ?? 'Uncategorised';
    const cs = categoryStats.get(cat);
    if (cs && cs.n >= MIN_CATEGORY_COMPARABLES) {
      return { stats: cs, source: cat };
    }
    return { stats: globalStats, source: 'global fallback' };
  };

  const candidates = protocols.filter(
    (p) => p.gecko_id === null && p.symbol === null,
  );

  const calcs: CandidateCalc[] = candidates.map((p) => {
    const { stats, source } = statsFor(p);
    const momentum = momentumFactor(p.change_7d);
    const age = ageFactor(p.listed_at, as_of);
    const chainsF = chainsFactor(p.chains.length);
    const adj = momentum * age * chainsF;
    const variants = [
      Math.max(1, Math.round(p.tvl_usd)),
      Math.max(1, Math.round(p.tvl_usd * stats.median)),
      Math.max(1, Math.round(p.tvl_usd * stats.median * momentum)),
      Math.max(1, Math.round(p.tvl_usd * stats.median * momentum * age)),
      Math.max(1, Math.round(p.tvl_usd * stats.median * adj)),
    ];
    const full = variants[4];
    let bandLow = Math.max(
      1,
      Math.round(p.tvl_usd * stats.p25 * adj),
    );
    let bandHigh = Math.max(
      1,
      Math.round(p.tvl_usd * stats.p75 * adj),
    );
    if (bandLow > full) bandLow = full;
    if (bandHigh < full) bandHigh = full;
    return {
      p,
      multiple: stats.median,
      bandLowMult: stats.p25,
      bandHighMult: stats.p75,
      momentum,
      age,
      chainsF,
      stats,
      statsSource: source,
      variants,
      full,
      bandLow,
      bandHigh,
    };
  });

  const sorted = [...calcs].sort((a, b) => {
    if (b.full !== a.full) return b.full - a.full;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  const rows: Row[] = sorted.map((c, i) => {
    const m = c.full / c.p.tvl_usd;
    return {
      slug: c.p.slug,
      name: c.p.name,
      rank: i + 1,
      implied_value_usd: c.full,
      farm_steps: farmSteps(c.p),
      category: c.p.category ?? 'Uncategorised',
      tvl_usd: c.p.tvl_usd,
      change_7d: c.p.change_7d,
      chains_count: c.p.chains.length,
      chains: [...c.p.chains],
      listed_at: c.p.listed_at,
      multiple: round4(c.multiple),
      band_low_usd: c.bandLow,
      band_high_usd: c.bandHigh,
      verdict: m >= 0.8 ? 'FARM' : m >= 0.25 ? 'THIN' : 'SKIP',
      watchlist: watch.has(c.p.slug),
      stats_source: c.statsSource,
      stats_n: c.stats.n,
      momentum: round4(c.momentum),
      age_factor: round4(c.age),
      chains_factor: round4(c.chainsF),
    };
  });

  // Ablation ladder: each variant against the full model (A4).
  const fullTop40 = new Set(rows.slice(0, 40).map((r) => r.slug));
  const labels = [
    'TVL alone',
    '+ category multiple',
    '+ momentum',
    '+ token-free age',
    '+ chain reach (full model)',
  ];
  const ablation = labels.map((label, v) => {
    let shiftSum = 0;
    const variantSorted = [...calcs]
      .map((c) => ({ slug: c.p.slug, val: c.variants[v] }))
      .sort((a, b) => {
        if (b.val !== a.val) return b.val - a.val;
        return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      });
    for (const c of calcs) {
      shiftSum += Math.abs(Math.log(c.variants[v] / c.full));
    }
    const top = new Set(variantSorted.slice(0, 40).map((x) => x.slug));
    let overlap = 0;
    for (const s of top) if (fullTop40.has(s)) overlap++;
    return {
      step: 'A' + v,
      label,
      mean_abs_log_shift: round3(shiftSum / calcs.length),
      top40_overlap: overlap,
    };
  });

  const catStatsOut: Record<string, Stats> = {};
  for (const cat of [...categoryStats.keys()].sort()) {
    const s = categoryStats.get(cat) as Stats;
    catStatsOut[cat] = {
      median: round4(s.median),
      p25: round4(s.p25),
      p75: round4(s.p75),
      n: s.n,
    };
  }

  const covered = rows.filter((r) => r.watchlist).length;
  const data = {
    as_of,
    floor_usd: snapshot.floor_usd,
    counts: {
      scanned: protocols.length,
      tokenised: protocols.length - candidates.length,
      ranked: rows.length,
      watchlist: watchlist.length,
      watchlist_covered: covered,
    },
    model: {
      momentum_per_pct: MOMENTUM_PER_PCT,
      momentum_clamp: [MOMENTUM_MIN, MOMENTUM_MAX],
      age_per_year: AGE_PER_YEAR,
      age_max_years: AGE_MAX_YEARS,
      chain_per_extra: CHAIN_PER_EXTRA,
      chain_max_extra: CHAIN_MAX_EXTRA,
      min_category_comparables: MIN_CATEGORY_COMPARABLES,
      global: {
        median: round4(globalStats.median),
        p25: round4(globalStats.p25),
        p75: round4(globalStats.p75),
        n: globalStats.n,
      },
    },
    category_stats: catStatsOut,
    ablation,
    rows,
  };

  return { rows, data };
}
