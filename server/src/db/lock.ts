// Trava do DATA_DIR do PGlite (docs/specs/02-banco.md, "Migrações"): o dev, o migrador e o seed abrem o mesmo diretório;
// dois processos ao mesmo tempo corrompem o banco, e o seed apagaria o banco do dev em uso.
// O arquivo fica ao lado do diretório (padrão storage/pglite.lock) e guarda o PID; trava de processo morto é substituída.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class DataDirInUseError extends Error {
  readonly pid: number;
  constructor(dataDir: string, pid: number) {
    super(`DATA_DIR em uso pelo processo ${pid} (${lockPath(dataDir)}). Pare o npm run dev antes de continuar.`);
    this.name = 'DataDirInUseError';
    this.pid = pid;
  }
}

export function lockPath(dataDir: string): string {
  return `${path.resolve(dataDir)}.lock`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockPid(file: string): number | null {
  try {
    const pid = Number((JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown }).pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// Devolve a função que libera a trava (idempotente).
export function acquireDataDirLock(dataDir: string): () => void {
  const file = lockPath(dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const content = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, content, { flag: 'wx' });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (readLockPid(file) === process.pid) rmSync(file, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = readLockPid(file);
      if (pid !== null && isAlive(pid)) throw new DataDirInUseError(dataDir, pid);
      rmSync(file, { force: true }); // trava de um processo que já terminou
    }
  }
  throw new Error(`não foi possível criar ${file}`);
}
