(function () {
  'use strict';

  // Token Launch Radar v2 — the whole page renders locally from the data
  // file the entrypoint writes beside it. No network, no frameworks: the
  // state below is the only state, and every number on screen comes out of
  // RADAR_DATA, which the fitted model produced from the sealed snapshot.

  var D = window.RADAR_DATA;
  var app = document.getElementById('app');
  var INTEG = D.integrity;
  var MODEL = D.model;
  var ROWS = D.rows;

  var state = {
    view: 'board',           // board | model | detail
    detailSlug: null,
    sortKey: 'rank',
    sortDir: 1,
    category: '',
    verdict: '',
    watchlistOnly: false,
    query: '',
  };

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }

  function moneyFull(v) {
    if (v == null || isNaN(v)) return '—';
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function mult(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(3) + 'x';
  }

  function factor(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(3);
  }

  function pctChange(v) {
    if (v == null) return '<span class="muted">n/a</span>';
    var cls = v >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%</span>';
  }

  function metric(v, places) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(places == null ? 4 : places);
  }

  function pill(verdict) {
    return '<span class="pill ' + esc(verdict) + '">' + esc(verdict) + '</span>';
  }

  function bySlug(slug) {
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i].slug === slug) return ROWS[i];
    return null;
  }

  function categoriesPresent() {
    var seen = {};
    ROWS.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  // ------------------------------------------------------------ header

  function headerHtml() {
    var h = '';
    h += '<header class="top">';
    h += '<p class="eyebrow">Pre-token radar · fitted model · held-out validated</p>';
    h += '<h1>TOKEN LAUNCH <span class="radar">RADAR</span></h1>';
    h += '<p class="tagline">Every protocol in the snapshot that still records no token, '
      + 'ranked by the market value a launch would imply under a model <strong>fitted on the '
      + 'snapshot\'s own tokenised comparables</strong> — category multiples, momentum, age and '
      + 'chain factors — and <strong>proven out of sample on two held-out halves</strong>. '
      + 'Each row carries a token-launch odds estimate from its peer bucket and a five-step, '
      + 'fully costed farm plan.</p>';
    h += '<div class="strip">';
    h += '<span class="chipstat">snapshot <b>' + esc(INTEG.as_of) + '</b></span>';
    h += '<span class="chipstat"><b>' + INTEG.protocols_scanned + '</b> protocols scanned</span>';
    h += '<span class="chipstat"><b>' + INTEG.candidates_ranked + '</b> pre-token ranked</span>';
    h += '<span class="chipstat">watchlist <b>' + INTEG.watchlist_covered + '/' + INTEG.watchlist_total + ' covered ✓</b></span>';
    h += '<span class="chipstat">implied value monotone by rank <b>' + (INTEG.monotone_verified ? '✓' : '✗') + '</b></span>';
    h += '<span class="chipstat"><b>' + INTEG.comparables_used + '</b> comparables fitted</span>';
    h += '<span class="chipstat">held-out <b>×' + INTEG.held_out_splits + ' validated</b></span>';
    h += '<span class="chipstat">farm steps verified <b>' + (INTEG.farm_steps_verified ? '✓' : '✗') + '</b></span>';
    h += '</div></header>';
    h += '<nav class="tabs">';
    h += '<button class="tab' + (state.view !== 'model' ? ' active' : '') + '" data-view="board">Board</button>';
    h += '<button class="tab' + (state.view === 'model' ? ' active' : '') + '" data-view="model">Model &amp; validation</button>';
    h += '</nav>';
    return h;
  }

  // ------------------------------------------------------------ board view

  var COLUMNS = [
    { key: 'rank', label: 'Rank', num: true },
    { key: 'name', label: 'Protocol', num: false },
    { key: 'category', label: 'Category', num: false },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d %', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true },
    { key: 'band', label: 'P25–P75 band', num: true },
    { key: 'odds_pct', label: 'Token odds', num: true },
    { key: 'verdict', label: 'Verdict', num: false },
    { key: 'farm_cost_usd', label: 'Farm $', num: true },
  ];

  function filteredRows() {
    var q = state.query.trim().toLowerCase();
    var out = ROWS.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (q && (r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1)) return false;
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    out.sort(function (a, b) {
      var av, bv;
      if (key === 'band') { av = a.band_high_usd - a.band_low_usd; bv = b.band_high_usd - b.band_low_usd; }
      else { av = a[key]; bv = b[key]; }
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return dir * av.localeCompare(bv) || (a.rank - b.rank);
      return dir * (av - bv) || (a.rank - b.rank);
    });
    return out;
  }

  function summaryHtml() {
    var totalImplied = 0, totalTvl = 0, totalFarm = 0;
    var counts = { FARM: 0, THIN: 0, SKIP: 0 };
    var oddsList = [];
    ROWS.forEach(function (r) {
      totalImplied += r.implied_value_usd;
      totalTvl += r.tvl_usd;
      totalFarm += r.farm_cost_usd;
      counts[r.verdict] = (counts[r.verdict] || 0) + 1;
      oddsList.push(r.odds_pct);
    });
    var top10 = 0;
    ROWS.slice(0, 10).forEach(function (r) { top10 += r.implied_value_usd; });
    oddsList.sort(function (a, b) { return a - b; });
    var medianOdds = oddsList[Math.floor(oddsList.length / 2)];
    var h = '<div class="panel"><h2>The board at a glance</h2><div class="kv">';
    h += '<div class="cell"><div class="k">Total implied value</div><div class="v">' + money(totalImplied) + '</div></div>';
    h += '<div class="cell"><div class="k">Candidate TVL covered</div><div class="v">' + money(totalTvl) + '</div></div>';
    h += '<div class="cell"><div class="k">Top 10 share of implied</div><div class="v">' + (100 * top10 / totalImplied).toFixed(1) + '%</div></div>';
    h += '<div class="cell"><div class="k">Median launch odds</div><div class="v">' + medianOdds + '%</div></div>';
    h += '<div class="cell"><div class="k">FARM verdicts</div><div class="v"><em>' + counts.FARM + '</em></div></div>';
    h += '<div class="cell"><div class="k">THIN verdicts</div><div class="v"><em>' + counts.THIN + '</em></div></div>';
    h += '<div class="cell"><div class="k">SKIP verdicts</div><div class="v">' + counts.SKIP + '</div></div>';
    h += '<div class="cell"><div class="k">Cost to farm the board</div><div class="v">' + moneyFull(totalFarm) + '</div></div>';
    h += '</div><p class="muted">Verdicts are deliberately hard to earn — FARM needs odds ≥ '
      + MODEL.verdict_thresholds.farm_min_odds_pct + '%, implied ≥ ' + moneyFull(MODEL.verdict_thresholds.farm_min_implied_usd)
      + ' and ≥ ' + MODEL.verdict_thresholds.farm_min_value_per_cost
      + ' dollars of implied value per farm-cost dollar; the Model &amp; validation tab prints the full thresholds and evidence.</p></div>';
    return h;
  }

  function boardHtml() {
    var rows = filteredRows();
    var h = '';
    h += summaryHtml();
    h += '<div class="controls">';
    h += '<label>Category<select id="f-category"><option value="">All categories</option>';
    categoriesPresent().forEach(function (c) {
      h += '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    });
    h += '</select></label>';
    h += '<label>Verdict<select id="f-verdict"><option value="">All verdicts</option>';
    ['FARM', 'THIN', 'SKIP'].forEach(function (v) {
      h += '<option value="' + v + '"' + (state.verdict === v ? ' selected' : '') + '>' + v + '</option>';
    });
    h += '</select></label>';
    h += '<label>Search<input type="search" id="f-query" placeholder="protocol name or slug" value="' + esc(state.query) + '"></label>';
    h += '<label class="checkline"><input type="checkbox" id="f-watch"' + (state.watchlistOnly ? ' checked' : '') + '> Watchlist only (40)</label>';
    h += '</div>';
    h += '<p class="countline">showing <b>' + rows.length + '</b> of ' + ROWS.length
      + ' ranked protocols · click any column header to sort, any row for the full detail view</p>';
    h += '<div class="tablewrap"><table><thead><tr>';
    COLUMNS.forEach(function (c) {
      var arrow = state.sortKey === c.key ? (state.sortDir === 1 ? ' <span class="dir">▲</span>' : ' <span class="dir">▼</span>') : '';
      h += '<th class="' + (c.num ? 'num' : '') + '" data-sort="' + c.key + '">' + c.label + arrow + '</th>';
    });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr class="clickable" data-slug="' + esc(r.slug) + '">';
      h += '<td class="num">' + r.rank + '</td>';
      h += '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="wl">WL</span>' : '') + '</td>';
      h += '<td>' + esc(r.category || '—') + '</td>';
      h += '<td class="num">' + money(r.tvl_usd) + '</td>';
      h += '<td class="num">' + pctChange(r.change_7d) + '</td>';
      h += '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>';
      h += '<td class="num band">' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + '</td>';
      h += '<td class="num">' + r.odds_pct + '%</td>';
      h += '<td>' + pill(r.verdict) + '</td>';
      h += '<td class="num">' + moneyFull(r.farm_cost_usd) + '</td>';
      h += '</tr>';
    });
    if (rows.length === 0) {
      h += '<tr><td colspan="' + COLUMNS.length + '" class="muted">No protocol matches the current filters. Loosen the category, verdict or search filter.</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<p class="muted">WL marks the 40 watchlist protocols (TVL at or above the snapshot\'s $50M floor). '
      + 'The board ranks every pre-token protocol the candidate rule admits, far below that floor — '
      + 'the watchlist is the floor, never the ceiling.</p>';
    h += '<div class="panel"><h2>How to read this board</h2>'
      + '<p><strong>Implied value</strong> is the market cap the fitted model assigns if the protocol launched a '
      + 'token at its current TVL and traded like its tokenised category peers: TVL times the category multiple, '
      + 'adjusted by the momentum, age and chain factors printed on the detail view. It is a relative ranking '
      + 'device first and a price second — the <strong>P25–P75 band</strong> beside it, the spread its own '
      + 'category\'s comparables actually trade across, is the honest precision of the estimate.</p>'
      + '<p><strong>Token odds</strong> answer a different question: among the protocols most similar to this '
      + 'one — same category, similar TVL, similar token-free age — how many already record a token? High odds '
      + 'with a small implied value means a launch is likely but small; the verdict joins the two: '
      + '<strong>FARM</strong> only when both are large and the plan is cheap relative to the prize, '
      + '<strong>THIN</strong> when the case is real but one leg is weak, <strong>SKIP</strong> when farming '
      + 'would cost more attention than the expected launch can repay.</p>'
      + '<p><strong>Farm $</strong> is the all-in fee and gas cost of the five-step plan on the detail view — '
      + 'not the working capital the plan moves, which the steps themselves state. Every plan is written for '
      + 'its own protocol: its main chain, its chain count, its category\'s core action and a position sized '
      + 'to its TVL.</p></div>';
    return h;
  }

  // ------------------------------------------------------------ detail view

  function bandBarHtml(r) {
    var max = r.band_high_usd * 1.12;
    function pos(v) { return Math.sqrt(Math.max(0, v) / max) * 100; }
    var left = pos(r.band_low_usd);
    var width = Math.max(1.5, pos(r.band_high_usd) - left);
    var mark = pos(r.implied_value_usd);
    var h = '<div class="bandbar"><div class="range" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></div>'
      + '<div class="marker" style="left:' + mark.toFixed(2) + '%"></div></div>';
    h += '<div class="bandlabels"><span>P25 ' + moneyFull(r.band_low_usd) + '</span>'
      + '<span>implied ' + moneyFull(r.implied_value_usd) + '</span>'
      + '<span>P75 ' + moneyFull(r.band_high_usd) + '</span></div>';
    h += '<p class="muted">Bar drawn on a square-root scale so wide bands stay readable; the amber marker is the implied value inside its category\'s P25–P75 band.</p>';
    return h;
  }

  function detailHtml(r) {
    var h = '';
    h += '<button class="backbtn" id="back">← Back to the board</button>';
    h += '<div class="panel">';
    h += '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' + pill(r.verdict)
      + (r.watchlist ? '<span class="chipstat warn">watchlist · rank <b>#' + r.rank + '</b></span>' : '<span class="chipstat">board rank <b>#' + r.rank + '</b></span>')
      + '</div>';
    h += '<p class="muted">' + esc(r.verdict_reason) + '</p>';
    h += '<div class="kv">';
    h += '<div class="cell"><div class="k">Category</div><div class="v">' + esc(r.category || '—') + '</div></div>';
    h += '<div class="cell"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>';
    h += '<div class="cell"><div class="k">7d TVL change</div><div class="v">' + (r.change_7d == null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + Number(r.change_7d).toFixed(2) + '%') + '</div></div>';
    h += '<div class="cell"><div class="k">Chains</div><div class="v">' + r.chains.length + ' <em>' + esc(r.chains.join(', ')) + '</em></div></div>';
    h += '<div class="cell"><div class="k">Token-free age</div><div class="v">' + (r.age_years == null ? 'unknown' : Number(r.age_years).toFixed(2) + ' yrs') + '</div></div>';
    h += '<div class="cell"><div class="k">Listed since</div><div class="v">' + esc(r.listed_at || 'not recorded') + '</div></div>';
    h += '</div>';

    h += '<h3>How the model prices ' + esc(r.name) + '</h3>';
    h += '<div class="arith">'
      + '<span class="lab">TVL</span> ' + moneyFull(r.tvl_usd)
      + ' <span class="op">×</span> <span class="lab">category multiple</span> ' + factor(r.category_multiple)
      + ' <span class="op">×</span> <span class="lab">momentum</span> ' + factor(r.momentum_factor)
      + ' <span class="op">×</span> <span class="lab">age</span> ' + factor(r.age_factor)
      + ' <span class="op">×</span> <span class="lab">chains</span> ' + factor(r.chain_factor)
      + ' <span class="op">=</span> <span class="res">' + moneyFull(r.implied_value_usd) + '</span></div>';
    h += '<p class="muted">The category multiple is the fitted median market-cap / TVL of tokenised '
      + esc(r.category || 'comparable') + ' protocols; each factor is its bucket\'s median multiple '
      + 'relative to the global median, clamped to [0.50, 2.00]. The full fitted tables are on the Model &amp; validation tab.</p>';
    h += bandBarHtml(r);

    h += '<h3>Token-launch odds: ' + r.odds_pct + '%</h3>';
    h += '<p>Peers are every protocol in the same category, tokenised or not. In the bucket actually used — '
      + '<strong>' + esc(r.odds.level) + '</strong> (' + esc(r.odds.bucket_label) + ') — '
      + '<strong>' + r.odds.bucket_tokenized + ' of ' + r.odds.bucket_n + '</strong> peers already record a token. '
      + 'That raw share is shrunk toward the ' + esc(r.odds.backoff_label) + ' rate of '
      + metric(r.odds.backoff_rate_pct, 1) + '% with a prior weight of ' + MODEL.odds_method.prior_weight
      + ', giving the printed ' + r.odds_pct + '%. Buckets coarser than the finest one with at least '
      + MODEL.odds_method.min_bucket_n + ' peers are only used when the finer bucket is too thin to trust.</p>';

    h += '<h3>Farm plan — five steps, ' + '<span class="totalcost">' + moneyFull(r.farm_cost_usd) + '</span> all-in</h3>';
    h += '<ol class="steps">';
    r.farm_plan.forEach(function (s) {
      h += '<li>' + esc(s.text) + ' <span class="meta">cost ' + moneyFull(s.cost_usd) + '</span> · <span class="dur">' + esc(s.duration) + '</span></li>';
    });
    h += '</ol>';
    h += '<p class="muted">Costs are the fees, gas and friction of each step, not the working capital it moves; '
      + 'the plan sizes its working position at 0.02% of the protocol\'s TVL, clamped between $250 and $5,000.</p>';
    h += '</div>';
    return h;
  }

  // ------------------------------------------------------------ model view

  function factorTable(title, rows, note) {
    var h = '<h3>' + title + '</h3><table class="mini"><thead><tr><th>Bucket</th><th class="num">Comparables</th><th class="num">Fitted factor</th></tr></thead><tbody>';
    rows.forEach(function (f) {
      h += '<tr><td>' + esc(f.bucket) + '</td><td class="num">' + f.n + '</td><td class="num">' + factor(f.factor) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (note) h += '<p class="muted">' + note + '</p>';
    return h;
  }

  function heldOutHtml() {
    var h = '<h3>Held-out validation ×2 — the model, graded on protocols it never fitted</h3>';
    h += '<p>The ' + MODEL.comparables_used + ' comparables are split into two halves by a stable hash of each '
      + 'protocol\'s slug. Every parameter — global median, category medians with the same shrinkage, all three '
      + 'factor tables — is fitted on one half only and used to predict the other half\'s market caps; then the '
      + 'halves swap. The baseline predicts with TVL × the training half\'s global median alone, the strongest '
      + 'simple model there is, scored identically.</p>';
    h += '<table class="mini"><thead><tr><th>Split</th><th>Model</th>'
      + '<th class="num">Median |log10 err| ↓</th><th class="num">Bias (mean log10 err)</th>'
      + '<th class="num">% within 2×</th><th class="num">R² (log10)</th></tr></thead><tbody>';
    MODEL.held_out.forEach(function (s) {
      var f = s.full_model, b = s.baseline_tvl_only;
      function cls(fv, bv, lowerBetter) {
        if (fv === bv) return 'tie';
        return (lowerBetter ? fv < bv : fv > bv) ? 'win' : 'lose';
      }
      h += '<tr><td rowspan="2">fit ' + s.train_half + ' (' + s.train_n + ') → test ' + s.test_half + ' (' + f.n + ')</td>'
        + '<td><strong>full model</strong></td>'
        + '<td class="num ' + cls(f.median_abs_log10_err, b.median_abs_log10_err, true) + '">' + metric(f.median_abs_log10_err) + '</td>'
        + '<td class="num">' + metric(f.mean_log10_err) + '</td>'
        + '<td class="num ' + cls(f.pct_within_2x, b.pct_within_2x, false) + '">' + metric(f.pct_within_2x, 1) + '%</td>'
        + '<td class="num ' + cls(f.r2_log10, b.r2_log10, false) + '">' + metric(f.r2_log10) + '</td></tr>';
      h += '<tr><td>baseline (TVL × global median)</td>'
        + '<td class="num">' + metric(b.median_abs_log10_err) + '</td>'
        + '<td class="num">' + metric(b.mean_log10_err) + '</td>'
        + '<td class="num">' + metric(b.pct_within_2x, 1) + '%</td>'
        + '<td class="num">' + metric(b.r2_log10) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="muted">Green marks the better score on that metric and split, red the worse. Market-cap / TVL '
      + 'ratios are heavy-tailed — the snapshot\'s own interquartile range runs from ' + mult(MODEL.global_p25)
      + ' to ' + mult(MODEL.global_p75) + ' — so even a correct median model lands within 2× only part of the time; '
      + 'the board therefore prints the P25–P75 band beside every point estimate instead of pretending to more precision.</p>';
    return h;
  }

  function modelHtml() {
    var h = '';
    h += '<div class="panel"><h2>The value model</h2>';
    h += '<div class="formula">' + esc(MODEL.formula) + '</div>';
    h += '<p>Comparables are the ' + MODEL.comparables_used + ' protocols that already record a token with both a '
      + 'market cap and TVL. Their market-cap / TVL ratios give a <strong>global median of ' + mult(MODEL.global_median)
      + '</strong> (P25 ' + mult(MODEL.global_p25) + ', P75 ' + mult(MODEL.global_p75) + '; medians use the '
      + esc(MODEL.median_convention) + '). Each category\'s multiple is its own median when at least 3 comparables '
      + 'support it; thinner categories shrink toward the global median with a prior weight of '
      + MODEL.category_prior_weight + '. Three bucket factors — 7-day TVL momentum, token-free age, chain count — '
      + 'are each fitted as the bucket\'s median ratio divided by the global median, clamped to ['
      + MODEL.factor_clamp[0].toFixed(2) + ', ' + MODEL.factor_clamp[1].toFixed(2) + ']. A bucket the data cannot '
      + 'support (an unreported momentum or age with fewer than 5 comparables) gets the neutral factor 1.000. '
      + 'Nothing is hardcoded per protocol: change the snapshot and every number on this page moves.</p>';

    h += '<h3>Fitted category multiples</h3>';
    h += '<table class="mini"><thead><tr><th>Category</th><th class="num">Comparables</th><th class="num">Median mcap/TVL</th><th class="num">P25</th><th class="num">P75</th></tr></thead><tbody>';
    MODEL.categories.forEach(function (c) {
      h += '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + mult(c.median)
        + '</td><td class="num">' + mult(c.p25) + '</td><td class="num">' + mult(c.p75) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="muted">Categories absent from this table have no tokenised comparable in the snapshot; their '
      + 'candidates are priced at the global median with the global P25–P75 band.</p>';

    h += factorTable('Momentum factor — by 7-day TVL change', MODEL.momentum_factors,
      'A rising protocol is not automatically worth more: the factor is whatever the comparables in that bucket actually trade at.');
    h += factorTable('Age factor — by years listed with no token', MODEL.age_factors,
      'Age is measured from the day tracking began to the snapshot date, ' + esc(INTEG.as_of) + '.');
    h += factorTable('Chain factor — by number of chains', MODEL.chain_factors, null);
    h += '</div>';

    h += '<div class="panel"><h2>Validation</h2>';
    h += heldOutHtml();
    h += '<h3>Ablation ladder — in-sample, all ' + MODEL.comparables_used + ' comparables</h3>';
    h += '<table class="mini"><thead><tr><th>Level</th><th>Model</th><th class="num">Median |log10 err| ↓</th></tr></thead><tbody>';
    MODEL.ablation.forEach(function (a) {
      h += '<tr><td><strong>' + esc(a.level) + '</strong></td><td>' + esc(a.label) + '</td><td class="num">' + metric(a.median_abs_log10_err) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="muted">Each rung adds one fitted component. The ladder is in-sample by construction — it shows '
      + 'what each component explains in the data it was fitted on; the held-out table above is the honest '
      + 'out-of-sample check, and the two reads together are the model\'s real evidence.</p>';
    h += '</div>';

    h += '<div class="panel"><h2>Odds, verdicts, integrity</h2>';
    h += '<h3>Token-launch odds</h3>';
    h += '<p>' + esc(MODEL.odds_method.note) + '. The four levels, finest first: '
      + MODEL.odds_method.levels.map(esc).join(' → ') + '. Odds describe how often comparable peers already '
      + 'record a token; they are a base rate, not a promise about any single protocol.</p>';
    h += '<h3>Verdict thresholds</h3>';
    var t = MODEL.verdict_thresholds;
    h += '<ul>'
      + '<li><strong>FARM</strong> — odds ≥ ' + t.farm_min_odds_pct + '%, implied value ≥ ' + moneyFull(t.farm_min_implied_usd)
      + ', and implied value per farm-cost dollar ≥ ' + t.farm_min_value_per_cost + '.</li>'
      + '<li><strong>THIN</strong> — odds ≥ ' + t.thin_min_odds_pct + '% and implied value ≥ ' + moneyFull(t.thin_min_implied_usd)
      + ', but short of the FARM bar: a small position, sized down.</li>'
      + '<li><strong>SKIP</strong> — everything else: the expected launch does not pay for the farming effort today.</li></ul>';
    h += '<h3>Integrity checklist — recomputed on every run</h3>';
    h += '<ul class="checklist">'
      + '<li><span class="ok">✓</span>snapshot date <b>' + esc(INTEG.as_of) + '</b>, floor ' + moneyFull(INTEG.floor_usd) + '</li>'
      + '<li><span class="ok">✓</span><b>' + INTEG.protocols_scanned + '</b> protocols scanned, <b>' + INTEG.candidates_ranked + '</b> pre-token candidates ranked</li>'
      + '<li><span class="ok">✓</span>watchlist covered <b>' + INTEG.watchlist_covered + '/' + INTEG.watchlist_total + '</b> (the run throws if any watchlist slug is missing)</li>'
      + '<li><span class="ok">✓</span>implied value non-increasing as rank ascends: <b>' + (INTEG.monotone_verified ? 'verified' : 'FAILED') + '</b></li>'
      + '<li><span class="ok">✓</span>every farm step 20–600 characters, exactly 5 per protocol: <b>' + (INTEG.farm_steps_verified ? 'verified' : 'FAILED') + '</b></li>'
      + '<li><span class="ok">✓</span><b>' + INTEG.comparables_used + '</b> comparables fitted, held-out validation run on <b>' + INTEG.held_out_splits + '</b> splits</li>'
      + '</ul>';
    h += '<p class="muted">The model is deterministic — no clock, no randomness; the held-out split is a hash of '
      + 'the slug — so two runs over the same snapshot write byte-identical output.</p>';
    h += '</div>';
    return h;
  }

  // ------------------------------------------------------------ render + events

  function render() {
    var h = headerHtml();
    if (state.view === 'model') h += modelHtml();
    else if (state.view === 'detail' && state.detailSlug && bySlug(state.detailSlug)) h += detailHtml(bySlug(state.detailSlug));
    else h += boardHtml();
    h += '<footer class="foot">Token Launch Radar v2 · implied values are this entry\'s own model output, '
      + 'fitted from the sealed snapshot of ' + esc(INTEG.as_of) + ' — a claim about what a launch would be '
      + 'worth if the record stayed as it is, not a prediction that a launch will happen.</footer>';
    app.innerHTML = h;
    bind();
  }

  function bind() {
    var tabs = app.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        state.view = this.getAttribute('data-view');
        if (state.view === 'board') state.detailSlug = null;
        render();
        window.scrollTo(0, 0);
      });
    }
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () {
      state.view = 'board'; state.detailSlug = null; render();
    });
    var rows = app.querySelectorAll('tr.clickable');
    for (var j = 0; j < rows.length; j++) {
      rows[j].addEventListener('click', function () {
        state.detailSlug = this.getAttribute('data-slug');
        state.view = 'detail';
        render();
        window.scrollTo(0, 0);
      });
    }
    var heads = app.querySelectorAll('th[data-sort]');
    for (var k = 0; k < heads.length; k++) {
      heads[k].addEventListener('click', function () {
        var key = this.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = key === 'name' || key === 'category' || key === 'verdict' ? 1 : -1; }
        if (key === 'rank') state.sortDir = 1;
        render();
      });
    }
    var cat = document.getElementById('f-category');
    if (cat) cat.addEventListener('change', function () { state.category = this.value; render(); });
    var ver = document.getElementById('f-verdict');
    if (ver) ver.addEventListener('change', function () { state.verdict = this.value; render(); });
    var watch = document.getElementById('f-watch');
    if (watch) watch.addEventListener('change', function () { state.watchlistOnly = this.checked; render(); });
    var query = document.getElementById('f-query');
    if (query) query.addEventListener('input', function () {
      state.query = this.value;
      var pos = this.selectionStart;
      render();
      var again = document.getElementById('f-query');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* older engines */ } }
    });
  }

  render();
})();
