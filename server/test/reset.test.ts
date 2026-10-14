// Travas do reset (docs/specs/02-banco.md, "Migrações"): db:seed recusa com o dev rodando e só apaga banco de dev/teste.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataDirInUseError, acquireDataDirLock, lockPath } from '#server/db/lock.ts';
import { ResetRefusedError, assertPgResetAllowed, recreatePgliteDir } from '#server/db/reset.ts';
import { openDatabase } from '#server/db/open.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'psf-reset-'));

function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', '']);
  assert.ok(r.pid, 'sem pid');
  return r.pid;
}

describe('trava do DATA_DIR (PGlite)', () => {
  test('o arquivo de trava fica ao lado do DATA_DIR (storage/pglite.lock no padrão)', () => {
    assert.equal(lockPath(path.resolve('storage/pglite')), path.resolve('storage/pglite.lock'));
  });

  test('segunda trava no mesmo DATA_DIR é recusada enquanto a primeira estiver viva; liberar apaga o arquivo', () => {
    const dir = tempDir();
    const dataDir = path.join(dir, 'pglite');
    try {
      const release = acquireDataDirLock(dataDir);
      assert.ok(existsSync(lockPath(dataDir)));
      assert.throws(() => acquireDataDirLock(dataDir), (e: unknown) => e instanceof DataDirInUseError && e.pid === process.pid);
      release();
      assert.ok(!existsSync(lockPath(dataDir)));
      acquireDataDirLock(dataDir)();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('trava de processo que já terminou é substituída', () => {
    const dir = tempDir();
    const dataDir = path.join(dir, 'pglite');
    try {
      writeFileSync(lockPath(dataDir), JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
      const release = acquireDataDirLock(dataDir);
      assert.equal(JSON.parse(readFileSync(lockPath(dataDir), 'utf8')).pid, process.pid);
      release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recria só diretório vazio, inexistente ou de PGlite (com PG_VERSION)', () => {
    const dir = tempDir();
    try {
      const pglite = path.join(dir, 'pglite');
      mkdirSync(pglite);
      writeFileSync(path.join(pglite, 'PG_VERSION'), '18\n');
      recreatePgliteDir(pglite);
      assert.ok(!existsSync(pglite));
      recreatePgliteDir(path.join(dir, 'nao-existe'));

      const other = path.join(dir, 'outra-coisa');
      mkdirSync(other);
      writeFileSync(path.join(other, 'importante.txt'), 'não apagar');
      assert.throws(() => recreatePgliteDir(other), ResetRefusedError);
      assert.ok(existsSync(path.join(other, 'importante.txt')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('trava do reset com DATABASE_URL (pg)', () => {
  test('exige SEED_RESET=yes e banco terminado em _dev ou _test', () => {
    assert.throws(() => assertPgResetAllowed('psf_dev', false), ResetRefusedError);
    assert.throws(() => assertPgResetAllowed('psf', true), ResetRefusedError);
    assert.throws(() => assertPgResetAllowed('psf_producao', true), ResetRefusedError);
    assert.throws(() => assertPgResetAllowed('psf_dev_backup', true), ResetRefusedError);
    assertPgResetAllowed('psf_dev', true);
    assertPgResetAllowed('psf_test', true);
  });
});

describe('openDatabase no PGlite em disco', () => {
  test('segura a trava enquanto aberto; recreate apaga o banco anterior; close libera', async () => {
    const dir = tempDir();
    const config = { dataDir: path.join(dir, 'pglite'), databaseUrl: undefined, seedReset: false };
    try {
      const first = await openDatabase(config);
      await first.exec('create table marcador (id integer)');
      await assert.rejects(openDatabase(config, { recreate: true }), DataDirInUseError);
      await first.close();
      assert.ok(!existsSync(lockPath(config.dataDir)));

      const again = await openDatabase(config);
      assert.deepEqual((await again.query(`select to_regclass('public.marcador')::text as t`)).rows, [{ t: 'marcador' }]);
      await again.close();

      const fresh = await openDatabase(config, { recreate: true });
      assert.deepEqual((await fresh.query(`select to_regclass('public.marcador')::text as t`)).rows, [{ t: null }]);
      await fresh.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('npm run db:seed recusa com o DATA_DIR em uso e não apaga nada', () => {
    const dir = tempDir();
    const dataDir = path.join(dir, 'pglite');
    mkdirSync(dataDir);
    writeFileSync(path.join(dataDir, 'PG_VERSION'), '18\n');
    const release = acquireDataDirLock(dataDir); // faz o papel do npm run dev
    try {
      const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'db_seed.ts')], {
        cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir, DATABASE_URL: '' },
      });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /em uso pelo processo/);
      assert.ok(existsSync(path.join(dataDir, 'PG_VERSION')), 'o banco do dev continua lá');
    } finally {
      release();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
