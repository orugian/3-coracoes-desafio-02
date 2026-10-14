// npm run fixtures:piloto: lê o index.html de um commit do front (padrão f89cef4; PILOTO_COMMIT troca) e grava
// - packages/engine/test/fixtures/piloto.json (fixture do teste de paridade, docs/specs/01-motor.md)
// - db/seed/fontes/piloto.json (fonte do seed, docs/specs/03-seed.md), no envelope { source, file, sha256, extractedAt, rows }.
// Não editar os dois arquivos à mão.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractPilotData, FIXTURE_PATH, REPO_ROOT, type PilotFixture } from '../packages/engine/test/piloto.ts';

const SEED_SOURCE_PATH = path.join(REPO_ROOT, 'db', 'seed', 'fontes', 'piloto.json');

const requested = process.env.PILOTO_COMMIT?.trim() || 'f89cef4';
const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const commit = git(['rev-parse', '--verify', '--end-of-options', `${requested}^{commit}`]).trim();
const html = git(['show', `${commit}:index.html`]);
const data = extractPilotData(html);
const fixture: PilotFixture = { commit, file: 'index.html', ...data };

function write(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

write(FIXTURE_PATH, fixture);

// sha256 do index.html do commit, com \r\n trocado por \n (README das specs, "Ciclo de vida das fontes").
const sha256 = createHash('sha256').update(html.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const head = { source: 'PILOTO', file: 'index.html', commit, sha256 };
const body = { rows: data.P, vehicles: data.VEH, clients: data.CLIENTS, rules: data.RULES };
const comparable = (doc: Record<string, unknown>) => JSON.stringify({ ...doc, extractedAt: undefined });
let extractedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
if (existsSync(SEED_SOURCE_PATH)) {
  const old = JSON.parse(readFileSync(SEED_SOURCE_PATH, 'utf8')) as Record<string, unknown>;
  if (typeof old.extractedAt === 'string' && comparable(old) === comparable({ ...head, extractedAt: '', ...body })) {
    extractedAt = old.extractedAt;
  }
}
write(SEED_SOURCE_PATH, { ...head, extractedAt, ...body });

console.log(
  `piloto do commit ${commit.slice(0, 7)} (${fixture.P.length} SKUs, ${Object.keys(fixture.VEH).length} veículos, ` +
    `${Object.keys(fixture.CLIENTS).length} clientes) gravado em ${path.relative(REPO_ROOT, FIXTURE_PATH)} e ${path.relative(REPO_ROOT, SEED_SOURCE_PATH)}`,
);
