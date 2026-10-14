// npm run fixtures:piloto: gera packages/engine/test/fixtures/piloto.json a partir do index.html de um commit do front
// (padrão f89cef4; PILOTO_COMMIT troca). docs/specs/01-motor.md, "Teste de paridade com o piloto". Não editar a fixture à mão.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractPilotData, FIXTURE_PATH, REPO_ROOT, type PilotFixture } from '../packages/engine/test/piloto.ts';

const requested = process.env.PILOTO_COMMIT?.trim() || 'f89cef4';
const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const commit = git(['rev-parse', '--verify', '--end-of-options', `${requested}^{commit}`]).trim();
const html = git(['show', `${commit}:index.html`]);
const fixture: PilotFixture = { commit, file: 'index.html', ...extractPilotData(html) };

mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
console.log(
  `fixture do piloto gravada: ${path.relative(REPO_ROOT, FIXTURE_PATH)} (commit ${commit.slice(0, 7)}, ` +
    `${fixture.P.length} SKUs, ${Object.keys(fixture.VEH).length} veículos, ${Object.keys(fixture.CLIENTS).length} clientes)`,
);
