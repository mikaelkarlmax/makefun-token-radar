// Token Launch Radar v2 — entrypoint.
// Reads the sealed snapshot, fits the model, ranks the pre-token board and
// writes the full output bundle: board.json for the gate, data.js for the
// dashboard, copies of dashboard/ and screenshots/, and dossier.json built
// with the vendor library exactly as the scorer rebuilds it.
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard } from './lib/model.ts';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CliOptions {
  input: string;
  output: string;
}

function readOptions(argv: string[]): CliOptions {
  const opts: CliOptions = {
    input: '/input',
    output: process.env.MAKEFUN_OUTPUT_DIR || '/output',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--input' && argv[i + 1]) opts.input = argv[++i];
    else if (flag === '--output' && argv[i + 1]) opts.output = argv[++i];
  }
  return opts;
}

function snapshotFile(input: string): string {
  return statSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
}

function copyFlat(sourceDir: string, targetDir: string): string[] {
  mkdirSync(targetDir, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(sourceDir).sort()) {
    const from = join(sourceDir, name);
    if (statSync(from).isFile()) {
      copyFileSync(from, join(targetDir, name));
      names.push(name);
    }
  }
  return names;
}

function run(): void {
  const opts = readOptions(process.argv.slice(2));
  const repoRoot = dirname(fileURLToPath(import.meta.url));

  const snapshot = JSON.parse(readFileSync(snapshotFile(opts.input), 'utf8'));
  const board = buildBoard(snapshot);

  mkdirSync(opts.output, { recursive: true });

  // board.json — the gate's rows: the required fields plus the radar extras.
  const boardRows = board.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
    category: r.category,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    odds_pct: r.odds_pct,
    band_low_usd: r.band_low_usd,
    band_high_usd: r.band_high_usd,
    verdict: r.verdict,
    farm_cost_usd: r.farm_cost_usd,
  }));
  writeFileSync(join(opts.output, 'board.json'), JSON.stringify({ rows: boardRows }) + '\n');

  // data.js — everything the dashboard renders: integrity, model, full rows.
  const payload = {
    integrity: board.integrity,
    model: board.model,
    rows: board.rows,
  };
  writeFileSync(join(opts.output, 'data.js'), 'window.RADAR_DATA = ' + JSON.stringify(payload) + ';\n');

  // dashboard/ and screenshots/ travel with the output.
  copyFlat(join(repoRoot, 'dashboard'), join(opts.output, 'dashboard'));
  copyFlat(join(repoRoot, 'screenshots'), join(opts.output, 'screenshots'));

  // dossier.json last: it is built from the dashboard and screenshots above.
  const dossier = buildDossier(opts.output, { text_max_bytes: 65536 });
  writeFileSync(join(opts.output, 'dossier.json'), dossier);

  const farmCount = board.rows.filter((r) => r.verdict === 'FARM').length;
  console.log(
    'Token Launch Radar v2: ' + board.rows.length + ' candidates ranked, ' +
    farmCount + ' FARM verdicts, watchlist ' +
    String(board.integrity.watchlist_covered) + '/' + String(board.integrity.watchlist_total) +
    ' covered -> ' + opts.output,
  );
}

run();
