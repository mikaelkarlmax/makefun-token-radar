# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mikaelkarlmax/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mikaelkarlmax/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar v2 scans all 758 protocols in the sealed snapshot and ranks every pre-token candidate it finds by the market value a token launch would imply. Version 2 rebuilds the model end to end: instead of hand-set adjustments, every parameter is now **fitted from the snapshot's own tokenised comparables** and **validated out of sample**.

## What the v2 model does

- **Fitted category multiples.** Each category is priced at the median market-cap/TVL of its tokenised comparables; categories with fewer than 3 comparables shrink toward the global median (prior weight 3) instead of trusting a thin sample. Every value carries a P25–P75 band from the same category.
- **Fitted bucket factors.** Momentum (7-day TVL change), token-free age, and chain count each contribute a factor equal to their bucket's median multiple divided by the global median, clamped to [0.5, 2.0]. Unsupported buckets fall back to the neutral factor 1.
- **Held-out validation ×2.** The comparables are split into halves by a stable slug hash; all parameters are fitted on one half and scored on the other (median |log10 error|, bias, % within 2×, R² on log10 scale), then the halves swap. A TVL-only baseline is scored the same way, and an in-sample ablation ladder (A0–A4) shows what each model component explains. The dashboard's Model & validation tab prints all of it.
- **Token-launch odds.** For each candidate, the share of peer protocols that already record a token — peers bucketed by category × TVL band × age band, backing off to coarser buckets when a bucket holds fewer than 8 peers, shrunk toward the coarser rate with a prior weight of 4.
- **Verdicts and costed farm plans.** FARM / THIN / SKIP verdicts from printed thresholds (odds, implied value, and implied value per farm-cost dollar), and exactly five farm steps per protocol — category-aware, sized to the protocol's TVL, each naming a concrete action, a USD cost, and a duration.
- **Integrity strip.** The dashboard header recomputes and displays the run's own checks: snapshot date, protocols scanned, candidates ranked, watchlist covered 40/40, monotone-by-rank verified, comparables fitted, held-out ×2 validated. The program throws rather than emit a board that fails them.

The model is deterministic — no clock, no randomness — so two runs over the same snapshot write byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`--input` accepts the snapshot file itself or a directory containing `snapshot.json`; `--output` overrides the output directory. Requires Node 22.18 or later; standard library only. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/`, and `dossier.json` (built with `vendor/makefun-board.ts`) into the output directory.

---

Entered on [make.fun](https://make.fun/?ref=q8z3gt64&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
