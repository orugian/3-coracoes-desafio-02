// Comando reservado no package.json para uma fatia que ainda não foi implementada (docs/plano/PLANO.md).
// Cada fatia troca o script correspondente pelo comando real e, quando não houver mais nenhum, apaga este arquivo.
const [fatia = '?', comando = '?'] = process.argv.slice(2);
console.error(`npm run ${comando}: ainda não implementado (fatia ${fatia}, docs/plano/PLANO.md).`);
process.exitCode = 1;
