/**
 * Entrypoint for Token Radar (make.fun bounty entry).
 *
 * This pipeline evaluates pre-token crypto protocols from a snapshot payload,
 * ranks and scores candidate opportunities using the valuation model,
 * emits the leaderboard datasets, stages the static dashboard interface
 * alongside required visual artifacts, and compiles the final verification dossier.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
import {
  fileURLToPath,
} from 'node:url';

import {
  boardIssue,
  buildRadar,
  dataScript,
} from './lib/board.ts';
import {
  parseSnapshot,
} from './lib/model.ts';
import {
  buildDossier,
} from './vendor/makefun-board.ts';

// Resolve repository root directory relative to this entrypoint module
const PROJECT_ROOT: string = fileURLToPath(new URL('.', import.meta.url));

// Gate limit specifications and asset validation thresholds
const TEXT_MAX_BYTES: number = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 } as const;
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 } as const;
const SCREENSHOT_NAME_REGEX = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Terminate execution with an error diagnostic and specific return code.
 */
function fail(errorMessage: string, exitCode: 1 | 2 = 1): never {
  process.stderr.write(errorMessage);
  process.exit(exitCode);
} // fail

/**
 * Extract a named parameter from command-line arguments.
 * Supports both standard formats: `--flag value` and `--flag=value`.
 */
function parseCliOption(flag: string, fallbackValue: string): string {
  const argv = process.argv;
  const flagKey = `--${flag}`;
  const flagPrefix = `--${flag}=`;

  const exactPos = argv.indexOf(flagKey);
  if (exactPos !== -1 && exactPos + 1 < argv.length) {
    return argv[exactPos + 1]!;
  }

  const prefixMatch = argv.find((token) => token.startsWith(flagPrefix));
  if (prefixMatch !== undefined) {
    return prefixMatch.slice(flagPrefix.length);
  }

  return fallbackValue;
} // parseCliOption

/**
 * Locate and verify the existence of the snapshot JSON file.
 * Halts execution with exit code 2 if the file cannot be accessed.
 */
function resolveInput(inputLocation: string): string {
  const resolvedPath = inputLocation.endsWith('.json')
    ? inputLocation
    : join(inputLocation, 'snapshot.json');

  if (!existsSync(resolvedPath)) {
    fail(
      `token radar: no snapshot at ${resolvedPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
      2,
    );
  }

  return resolvedPath;
} // resolveInput

/**
 * Parse snapshot data, calculate valuation radar metrics, and enforce gate checks.
 * Terminates with exit code 1 if the model produces an invalid board.
 */
function loadAndScore(snapshotPath: string) {
  const rawPayload = readFileSync(snapshotPath, 'utf8');
  const snapshot = parseSnapshot(rawPayload);
  const { board, radar } = buildRadar(snapshot);

  const validationIssue = boardIssue(board, snapshot);
  if (validationIssue !== null) {
    fail(
      `token radar: the model wrote a board the gate refuses: ${validationIssue}\n`,
      1,
    );
  }

  return { snapshot, board, radar };
} // loadAndScore

/**
 * Recursively transfer regular files from a source folder into the destination,
 * ignoring hidden or dot-prefixed filenames.
 */
function copyAssets(sourceDir: string, destDir: string): string[] {
  if (!existsSync(sourceDir)) {
    return [];
  }

  mkdirSync(destDir, { recursive: true });
  const copiedList: string[] = [];

  for (const entry of readdirSync(sourceDir)) {
    if (entry.startsWith('.')) {
      continue;
    }
    const fullPath = join(sourceDir, entry);
    if (!statSync(fullPath).isFile()) {
      continue;
    }
    copyFileSync(fullPath, join(destDir, entry));
    copiedList.push(entry);
  }

  return copiedList;
} // copyAssets

/**
 * Validate that screenshot assets meet count and naming constraints.
 * Fails with exit code 1 on missing required views or invalid character patterns.
 */
function validateScreenshots(images: readonly string[]): void {
  if (images.length < 3) {
    fail(
      `token radar: screenshots/ holds ${images.length} image${images.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
      1,
    );
  }

  for (const filename of images) {
    if (!SCREENSHOT_NAME_REGEX.test(filename)) {
      fail(
        `token radar: screenshots/${filename}: a name is letters, digits and . _ -, 1 to 128 characters\n`,
        1,
      );
    }
  }
} // validateScreenshots

/**
 * Persist the ranked board data and client-side data script into the output target.
 */
function writeOutputs(targetDir: string, board: unknown, radar: unknown): void {
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(targetDir, 'data.js'), dataScript(radar as any));
} // writeOutputs

/**
 * Generate and save the final dossier summary document using vendored board tooling.
 */
function writeDossier(targetDir: string): void {
  const dossierBytes = buildDossier(targetDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  });
  writeFileSync(join(targetDir, 'dossier.json'), dossierBytes);
} // writeDossier

/**
 * Log pipeline completion metrics to standard output.
 */
function report(
  outDir: string,
  snapshot: { protocols: unknown[]; watchlist: unknown[] },
  board: unknown[],
  radar: { early_size: number; live_size: number },
  dashFiles: string[],
  shotFiles: string[],
): void {
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} (${shotFiles.length} images) and ${join(outDir, 'dossier.json')}\n`,
  );
} // report

/**
 * Orchestrate the complete radar pipeline execution flow.
 */
function main(): void {
  const inputTarget = parseCliOption('input', '/input');
  const outputDir = parseCliOption(
    'output',
    process.env.MAKEFUN_OUTPUT_DIR ?? '/output',
  );

  const snapshotPath = resolveInput(inputTarget);
  const { snapshot, board, radar } = loadAndScore(snapshotPath);

  writeOutputs(outputDir, board, radar);

  const copiedDashboard = copyAssets(
    join(PROJECT_ROOT, 'dashboard'),
    join(outputDir, 'dashboard'),
  );

  const copiedScreenshots = copyAssets(
    join(PROJECT_ROOT, 'screenshots'),
    join(outputDir, 'screenshots'),
  );

  validateScreenshots(copiedScreenshots);

  // The dossier is constructed and written last following complete asset staging
  writeDossier(outputDir);

  report(
    outputDir,
    snapshot,
    board,
    radar,
    copiedDashboard,
    copiedScreenshots,
  );
} // main

main();
