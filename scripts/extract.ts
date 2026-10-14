// npm run extract: regenera todas as fontes do seed (docs/specs/03-seed.md, "Fluxo"):
// planilhas do SAP e da OB pelo extrator Python e o piloto pelo scripts/extrair_piloto.ts.
// Python: variável PYTHON, senão "python" no Windows e "python3" nos demais.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const python = process.env.PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3');

function run(cmd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): void {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) {
    process.exitCode = r.status ?? 1;
    throw new Error(`${cmd} ${args.join(' ')} saiu com código ${r.status}`);
  }
}

try {
  run(python, [path.join('db', 'seed', 'extrair_planilhas.py')], { PYTHONIOENCODING: 'utf-8' });
  run(process.execPath, [path.join('scripts', 'extrair_piloto.ts')]);
} catch (err) {
  console.error(`extract: ${(err as Error).message}`);
  process.exitCode ||= 1;
}
