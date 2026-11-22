# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mikaelkarlmax/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mikaelkarlmax/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar scans 758 protocols above a $50M TVL floor and ranks the 342 that still record no token by the market value a launch would imply. The model prices each candidate at TVL × the median market-cap/TVL multiple of tokenised comparables in its category, adjusted for 7-day momentum, token-free age and chain reach, with a P25–P75 value band, a FARM / THIN / SKIP verdict and a five-step farm playbook per protocol — all 40 watchlist protocols are covered, and an ablation ladder shows what each model factor actually changes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

Entered on [make.fun](https://make.fun/?ref=q8z3gt64&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
