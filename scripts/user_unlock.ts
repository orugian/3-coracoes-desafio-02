// npm run user:unlock -- <usuario> [<usuario> ...]: zera o contador de erros e o bloqueio de login (docs/specs/03-seed.md,
// "Usuários"; 04, "Sessão"). No PGlite, o DATA_DIR fica travado pelo npm run dev: pare o dev, rode o comando e suba de novo.
import { loadDatabaseConfig } from '#server/config.ts';
import { openDatabase } from '#server/db/open.ts';
import { unlockUser } from '#server/repo/users.ts';

const usernames = process.argv.slice(2).map((u) => u.trim()).filter(Boolean);
if (usernames.length === 0) {
  console.error('uso: npm run user:unlock -- <usuario> [<usuario> ...]');
  process.exit(1);
}

try {
  const db = await openDatabase(loadDatabaseConfig());
  try {
    for (const username of usernames) {
      if (await unlockUser(db, username)) console.log(`${username}: desbloqueado`);
      else {
        console.error(`${username}: usuário não encontrado`);
        process.exitCode = 1;
      }
    }
  } finally {
    await db.close();
  }
} catch (err) {
  console.error(`user:unlock: ${(err as Error).message}`);
  process.exitCode = 1;
}
