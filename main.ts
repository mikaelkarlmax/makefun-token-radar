// Token Launch Radar — entrypoint.
// Reads a sealed snapshot, builds the ranked board, and writes the dossier
// bundle (board.json, data.js, dashboard/, screenshots/, dossier.json).
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard } from './lib/model.ts';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input';
  let output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[++i];
    else if (argv[i] === '--output' && i + 1 < argv.length) output = argv[++i];
  }
  return { input, output };
}

function copyDirFiles(src: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const names = readdirSync(src).sort();
  const copied: string[] = [];
  for (const name of names) {
    const from = join(src, name);
    if (statSync(from).isFile()) {
      copyFileSync(from, join(dest, name));
      copied.push(name);
    }
  }
  return copied;
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));

  let snapshotPath = input;
  if (statSync(input).isDirectory()) snapshotPath = join(input, 'snapshot.json');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

  const { rows, data } = buildBoard(snapshot);

  mkdirSync(output, { recursive: true });

  // 1. board.json
  writeFileSync(join(output, 'board.json'), JSON.stringify({ rows }) + '\n');

  // 2. data.js at the output root
  writeFileSync(
    join(output, 'data.js'),
    'window.RADAR_DATA = ' + JSON.stringify(data) + ';\n',
  );

  // 3. dashboard/
  copyDirFiles(join(here, 'dashboard'), join(output, 'dashboard'));

  // 4. screenshots/
  const shots = copyDirFiles(
    join(here, 'screenshots'),
    join(output, 'screenshots'),
  );
  const imageShots = shots.filter((n) =>
    /\.(png|jpe?g|webp|gif)$/i.test(n),
  );

  // 5. dossier.json LAST — only when at least one screenshot exists, because
  // buildDossier refuses an empty screenshots directory.
  let dossierNote = 'dossier skipped (no screenshots yet)';
  if (imageShots.length >= 1) {
    writeFileSync(
      join(output, 'dossier.json'),
      buildDossier(output, {
        text_max_bytes: 65536,
        screenshots: { max: 4, max_bytes: 524288 },
        dashboard: { max_files: 400, max_bytes: 4194304 },
      }),
    );
    dossierNote = 'dossier.json written';
  }

  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  console.log(
    'Token Launch Radar: ranked ' +
      rows.length +
      ' pre-token protocols (' +
      data.counts.watchlist_covered +
      '/' +
      data.counts.watchlist +
      ' watchlist covered), total implied $' +
      totalImplied.toLocaleString('en-US') +
      ' -> ' +
      output +
      ' (' +
      dossierNote +
      ')',
  );
}

main();
