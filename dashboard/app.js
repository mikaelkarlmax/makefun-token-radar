(function () {
  'use strict';
  var D = window.RADAR_DATA;
  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(v) {
    if (v == null) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null) return '<span class="muted">—</span>';
    var cls = v >= 0 ? 'pos' : 'neg';
    var s = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    return '<span class="' + cls + '">' + s + '</span>';
  }
  function daysBetween(from, to) {
    var ms = Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z');
    return Math.floor(ms / 86400000);
  }
  function chip(v) { return '<span class="chip ' + v + '">' + v + '</span>'; }
  function bySlug(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }
  function categories() {
    var seen = {}, out = [];
    D.rows.forEach(function (r) { if (!seen[r.category]) { seen[r.category] = 1; out.push(r.category); } });
    return out.sort();
  }

  var state = { q: '', cat: '', wl: false, sort: 'implied' };

  function filteredRows() {
    var rows = D.rows.slice();
    if (state.cat) rows = rows.filter(function (r) { return r.category === state.cat; });
    if (state.wl) rows = rows.filter(function (r) { return r.watchlist; });
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) {
        return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0;
      });
    }
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
      multiple: function (r) { return r.multiple; }
    }[state.sort];
    rows.sort(function (a, b) { return key(b) - key(a) || (a.slug < b.slug ? -1 : 1); });
    return rows;
  }

  function boardView() {
    var c = D.counts, m = D.model, g = m.global;
    var total = D.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var cats = categories();
    var h = '';
    h += '<header class="top"><h1>Token Launch <span class="radar">Radar</span></h1>';
    h += '<p class="sub">Pre-token protocols ranked by the market value a token launch would imply, from tokenised comparables. Snapshot as of ' + esc(D.as_of) + ' · TVL floor ' + money(D.floor_usd) + '.</p></header>';
    h += '<div class="stats">';
    h += '<div class="stat"><div class="v">' + c.scanned + '</div><div class="k">Protocols scanned</div></div>';
    h += '<div class="stat"><div class="v">' + c.ranked + '</div><div class="k">Pre-token ranked</div></div>';
    h += '<div class="stat"><div class="v">' + c.watchlist_covered + '/' + c.watchlist + '</div><div class="k">Watchlist covered</div></div>';
    h += '<div class="stat"><div class="v">' + money(total) + '</div><div class="k">Total implied value</div></div>';
    h += '<div class="stat"><div class="v">' + g.median.toFixed(3) + '×</div><div class="k">Median mcap / TVL</div></div>';
    h += '</div>';

    h += '<div class="panel"><h2>The model</h2>';
    h += '<div class="formula">implied value = TVL × category multiple × momentum × token-free age × chain reach</div>';
    h += '<p>The multiple is the median market-cap / TVL ratio of tokenised comparables in the same category (used when a category has at least ' + m.min_category_comparables + ' comparables, otherwise the global fallback). Global comparables (n=' + g.n + '): median ' + g.median.toFixed(3) + '×, P25 ' + g.p25.toFixed(3) + '×, P75 ' + g.p75.toFixed(3) + '× — the P25–P75 range is the band on every row.</p>';
    h += '<p>Momentum = clamp(1 + 7d change × ' + m.momentum_per_pct + ', ' + m.momentum_clamp[0] + ', ' + m.momentum_clamp[1] + '). Age = 1 + ' + m.age_per_year + ' × years listed without a token (capped at ' + m.age_max_years + ' years). Chain reach = 1 + ' + m.chain_per_extra + ' × extra chains (capped at ' + m.chain_max_extra + '). Verdicts: effective multiple ≥ 0.80 → FARM, ≥ 0.25 → THIN, otherwise SKIP.</p>';
    h += '<h2>Ablation ladder</h2><table><thead><tr><th>Step</th><th>Variant</th><th class="num">Mean |log shift| vs full</th><th class="num">Top-40 overlap</th></tr></thead><tbody>';
    D.ablation.forEach(function (a) {
      h += '<tr><td>' + esc(a.step) + '</td><td>' + esc(a.label) + '</td><td class="num">' + a.mean_abs_log_shift.toFixed(3) + '</td><td class="num">' + a.top40_overlap + ' / 40</td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<div class="controls">';
    h += '<input type="text" id="q" placeholder="Search protocol or slug…" value="' + esc(state.q) + '">';
    h += '<select id="cat"><option value="">All categories</option>';
    cats.forEach(function (ct) {
      h += '<option value="' + esc(ct) + '"' + (state.cat === ct ? ' selected' : '') + '>' + esc(ct) + '</option>';
    });
    h += '</select>';
    h += '<label><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>';
    h += '<select id="sort">';
    [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['change', 'Sort: 7d change'], ['multiple', 'Sort: multiple']].forEach(function (o) {
      h += '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    });
    h += '</select></div>';

    var rows = filteredRows();
    h += '<div class="panel"><table><thead><tr><th class="num">#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Multiple</th><th class="num">Implied value</th><th class="num">P25–P75 band</th><th>Verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr class="clickable" data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>';
      h += '<td>' + esc(r.name) + (r.watchlist ? '<span class="badge">WL</span>' : '') + '</td>';
      h += '<td>' + esc(r.category) + '</td>';
      h += '<td class="num">' + money(r.tvl_usd) + '</td>';
      h += '<td class="num">' + pct(r.change_7d) + '</td>';
      h += '<td class="num">' + r.multiple.toFixed(3) + '×</td>';
      h += '<td class="num">' + money(r.implied_value_usd) + '</td>';
      h += '<td class="num muted">' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + '</td>';
      h += '<td>' + chip(r.verdict) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="muted">' + rows.length + ' of ' + D.rows.length + ' protocols shown. Click a row for the full dossier and farm playbook.</p></div>';
    h += '<footer>Deterministic board: every number is computed from the sealed snapshot dated ' + esc(D.as_of) + '. Implied values are model estimates from comparable multiples, not price predictions.</footer>';
    app.innerHTML = h;

    document.getElementById('q').addEventListener('input', function (e) {
      state.q = e.target.value; refreshTableOnly();
    });
    document.getElementById('cat').addEventListener('change', function (e) {
      var v = e.target.value;
      if (v) { location.hash = '#/f/' + encodeURIComponent(v); }
      else { state.cat = ''; location.hash = '#/'; }
    });
    document.getElementById('wl').addEventListener('change', function (e) {
      state.wl = e.target.checked; refreshTableOnly();
    });
    document.getElementById('sort').addEventListener('change', function (e) {
      state.sort = e.target.value; refreshTableOnly();
    });
    bindRowClicks();
  }

  function bindRowClicks() {
    var trs = app.querySelectorAll('tr.clickable');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () {
        location.hash = '#/p/' + encodeURIComponent(this.getAttribute('data-slug'));
      });
    }
  }

  function refreshTableOnly() {
    // Re-render the board but keep focus in the search box.
    var active = document.activeElement && document.activeElement.id;
    boardView();
    if (active === 'q') {
      var el = document.getElementById('q');
      el.focus(); el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  function detailView(slug) {
    var r = bySlug(slug);
    if (!r) { app.innerHTML = '<p>Unknown protocol. <a href="#/">Back to the board</a></p>'; return; }
    var days = r.listed_at ? daysBetween(r.listed_at, D.as_of) : null;
    var scaleMax = r.band_high_usd * 1.1;
    var left = (r.band_low_usd / scaleMax) * 100;
    var width = Math.max(1, ((r.band_high_usd - r.band_low_usd) / scaleMax) * 100);
    var marker = (r.implied_value_usd / scaleMax) * 100;
    var h = '<a class="back" href="#/">&larr; Back to the board</a>';
    h += '<header class="top"><h1>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h1>';
    h += '<p class="sub">Rank #' + r.rank + ' of ' + D.rows.length + ' · ' + esc(r.category) + ' · ' + chip(r.verdict) + '</p></header>';
    h += '<div class="panel"><h2>Implied value at launch</h2>';
    h += '<div class="big">' + money(r.implied_value_usd) + '</div>';
    h += '<div class="bandbar"><div class="band" style="left:' + left + '%;width:' + width + '%"></div><div class="marker" style="left:' + marker + '%"></div></div>';
    h += '<div class="bandlabels"><span>P25 ' + money(r.band_low_usd) + '</span><span>implied ' + money(r.implied_value_usd) + '</span><span>P75 ' + money(r.band_high_usd) + '</span></div>';
    h += '<h2>Factor breakdown</h2><table><tbody>';
    h += '<tr><td>TVL</td><td class="num">' + money(r.tvl_usd) + '</td></tr>';
    h += '<tr><td>× Category multiple (source: ' + esc(r.stats_source) + ', n=' + r.stats_n + ' comparables)</td><td class="num">' + r.multiple.toFixed(3) + '×</td></tr>';
    h += '<tr><td>× Momentum (7d change ' + (r.change_7d == null ? 'n/a' : r.change_7d.toFixed(2) + '%') + ')</td><td class="num">' + r.momentum.toFixed(3) + '×</td></tr>';
    h += '<tr><td>× Token-free age</td><td class="num">' + r.age_factor.toFixed(3) + '×</td></tr>';
    h += '<tr><td>× Chain reach (' + r.chains_count + ' chain' + (r.chains_count === 1 ? '' : 's') + ')</td><td class="num">' + r.chains_factor.toFixed(3) + '×</td></tr>';
    h += '<tr><td><strong>= Implied value</strong></td><td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td></tr>';
    h += '</tbody></table></div>';
    h += '<div class="panel"><h2>Protocol facts</h2><div class="detailgrid">';
    h += '<div class="kv"><div class="k">Chains</div><div class="v">' + esc(r.chains.join(', ') || '—') + '</div></div>';
    h += '<div class="kv"><div class="k">Listed since</div><div class="v">' + esc(r.listed_at || 'unknown') + '</div></div>';
    h += '<div class="kv"><div class="k">Days token-free</div><div class="v">' + (days == null ? 'unknown' : days) + '</div></div>';
    h += '<div class="kv"><div class="k">Verdict</div><div class="v">' + r.verdict + '</div></div>';
    h += '</div></div>';
    h += '<div class="panel"><h2>Farm playbook — five steps</h2><ol class="steps">';
    r.farm_steps.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ol></div>';
    app.innerHTML = h;
    window.scrollTo(0, 0);
  }

  function route() {
    var hash = location.hash || '#/';
    if (hash.indexOf('#/p/') === 0) { detailView(decodeURIComponent(hash.slice(4))); return; }
    if (hash.indexOf('#/f/') === 0) {
      state.cat = decodeURIComponent(hash.slice(4));
      boardView();
      return;
    }
    if (hash === '#/' || hash === '#') {
      if (state.cat && location.hash === '#/') { /* keep filter when re-rendering */ }
      boardView();
      return;
    }
    boardView();
  }

  window.addEventListener('hashchange', route);
  route();
})();
