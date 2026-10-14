// Datas de negócio no fuso de São Paulo (preço vigente, regra dos 7 dias). docs/specs/02-banco.md e 04-api.md.
const SAO_PAULO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function saoPauloDate(at: Date = new Date()): string {
  return SAO_PAULO.format(at); // en-CA formata como YYYY-MM-DD
}
