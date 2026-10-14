# 01 · Motor (`packages/engine`, `engine_version` 1)

O `engine_version` 1 é o `calc()` do piloto transformado em função pura: mesmas regras, mesmos arredondamentos e mesmo desempate, sem ler variáveis globais. Ele roda no servidor (resultado oficial, gravado em cada versão do pedido). No corte, o navegador continua usando o `calc()` do próprio HTML; os dois não podem divergir, e o teste de paridade garante isso. Base: §8 da arquitetura e `calc()` do piloto em `f89cef4`, o commit atual do front (Anexo D, P11). As regras são as mesmas desde `636ac8d`, com duas mudanças de forma: em `dca67be` o retorno ganhou `mode`, `mixed` e `veh`; em `f89cef4` o pedido sem itens passou a ser `blocking`. O juiz das specs implementou o contrato abaixo só pelo texto e comparou com o `calc()` de `dca67be` em 20.000 pedidos aleatórios, sem divergência.

## Estrutura

```
packages/engine/
  src/index.ts        export { calculate, ENGINE_VERSION } e os tipos
  src/types.ts
  src/calculate.ts
  test/golden.test.ts       casos de referência, variante "piloto"
  test/parity.test.ts       motor × calc() do HTML, pedidos aleatórios
  test/piloto.ts            carrega o calc() do HTML e converte a fixture
  test/fixtures/piloto.json   P, VEH, CLIENTS e RULES do piloto, com o commit de origem (gerada, não editar)
```

Sem dependências e sem I/O. Importado no servidor como `#engine`.

## Contrato

```ts
export const ENGINE_VERSION = 1;

export type LoadMode = 'PALLETIZED' | 'FLOOR';          // piloto: "pal" | "est"
export type Severity = 'BLOCK' | 'WARN';
export type AlertCode =
  | 'QTY_NOT_MULTIPLE' | 'BELOW_MIN_LOT' | 'NO_PRICE' | 'COUNTRY_RESTRICTED' | 'VEHICLE_EXCEEDED'   // BLOCK
  | 'PALLET_INCOMPLETE' | 'VEHICLE_UNDERFILLED';                                                    // WARN

export interface EngineItem {
  material: string;
  family: string;
  unitsPerBox: number;
  netKgPerBox: number;
  grossKgPerBox: number;
  volumeDm3: number;          // volume declarado (engine_version 1)
  layerBoxes: number;         // lastro efetivo (SAP ou override)
  layers: number;             // camadas efetivas
  minLotPallets: number;
  priceCents: number | null;  // preço da lista do cliente, já arredondado a 2 casas; null = sem preço
}

export interface EngineVehicle { id: string; palletPositions: number; volumeM3: number; payloadKg: number; }

export interface EngineInput {
  engineVersion: 1;
  items: EngineItem[];                 // a ordem define a ordem das linhas no resultado
  vehicle: EngineVehicle;
  mode: LoadMode;
  mixedPallet: boolean;
  restrictedMaterials: string[];       // de country_rule para o cliente
  lines: { material: string; boxes: number }[];   // caixas; fração é aceita e vira QTY_NOT_MULTIPLE
  rules: { fullAt: number };           // 0,9
}

export interface Alert { code: AlertCode; severity: Severity; material?: string; params?: Record<string, number>; }

export interface LineResult {
  material: string;
  requestedBoxes: number;
  boxes: number;              // inteiro: arredondado para cima se fracionário
  pallets: number;            // boxes ÷ (layerBoxes × layers), sem arredondar
  fullPallets: number;
  boxesToNextPallet: number;  // 0 se fecha pallet
  netKg: number; grossKg: number; m3: number;
  priceCents: number | null;
  valueCents: number;         // boxes × priceCents (0 sem preço)
  alerts: Alert[];
}

export interface EngineResult {
  engineVersion: 1;
  lines: LineResult[];
  totals: { boxes: number; pallets: number; positions: number; netKg: number; grossKg: number; m3: number; valueCents: number };
  utilization: { kg: number; m3: number; positions: number | null };   // frações (1 = 100%); positions null em FLOOR
  binding: 'kg' | 'm3' | 'positions';
  status: 'EMPTY' | 'PARTIAL' | 'FULL' | 'EXCEEDED';
  over: { positions: number; kg: number; m3: number };
  alerts: Alert[];            // do pedido (VEHICLE_EXCEEDED, VEHICLE_UNDERFILLED)
  blocking: boolean;          // pedido sem linhas, ou algum BLOCK em linha ou no pedido (regra de f89cef4)
}
// O servidor grava junto, em engine_result.inputs, o que não é cálculo: { priceDate, vehicleId, customerCode }.

export function calculate(input: EngineInput): EngineResult;
```

Material das linhas que não existe em `items`, material repetido nas linhas e quantidade que não seja número finito lançam `EngineInputError`; a API valida antes de chamar.

## Regras (iguais ao piloto)

`EPS = 1e-9`. Para cada item de `items`, na ordem, com quantidade `raw = max(0, caixas) ≥ EPS` (o piloto ignora a linha com `raw < EPS`, inclusive zero e negativo):

1. `inteiro = |raw − round(raw)| < 1e-6`; `boxes = inteiro ? round(raw) : ceil(raw)`. Se não for inteiro: `QTY_NOT_MULTIPLE` (BLOCK, `params: { lo: floor(raw), hi: ceil(raw) }`).
2. `boxesPerPallet = layerBoxes × layers`; `pallets = boxes ÷ boxesPerPallet`; `fullPallets = floor(pallets + EPS)`; há fração se `pallets − fullPallets > EPS`; `boxesToNextPallet = ceil(boxesPerPallet × (fullPallets + 1) − boxes − EPS)` se houver fração, senão 0.
3. Pesos e volume: `boxes × netKgPerBox`, `boxes × grossKgPerBox`, `boxes × volumeDm3 ÷ 1000`.
4. `valueCents = boxes × priceCents`; sem preço, `NO_PRICE` (BLOCK) e valor 0 (o item entra nos totais físicos).
5. `material ∈ restrictedMaterials` → `COUNTRY_RESTRICTED` (BLOCK).
6. `pallets + EPS < minLotPallets` → `BELOW_MIN_LOT` (BLOCK, `params: { minLot }`). Vale nos dois modos.
7. Há fração e o modo é `PALLETIZED` → `PALLET_INCOMPLETE` (WARN, `params: { boxesToNextPallet, nextPallet: fullPallets + 1 }`).
8. Posições: soma de `ceil(pallets − EPS)` por linha; com `mixedPallet`, `ceil(soma dos pallets − EPS)`.
9. Utilização: `kg = grossKg ÷ payloadKg`, `m3 = m3 ÷ volumeM3`, `positions = positions ÷ palletPositions` só em `PALLETIZED`.
10. Recurso limitante: entre `[kg, m3, positions]` (ou `[kg, m3]` em `FLOOR`), o maior; **empate fica com o primeiro da lista** (é o `reduce` do piloto, e o teste de paridade depende disso).
11. Status: sem linhas `EMPTY`; utilização máxima `> 1 + EPS` → `EXCEEDED` (alerta `VEHICLE_EXCEEDED`, BLOCK, `params: over`); `≥ fullAt` → `FULL`; senão `PARTIAL` (alerta `VEHICLE_UNDERFILLED`, WARN).
12. `over`: `max(0, posições − palletPositions)` (0 em `FLOOR`), `max(0, grossKg − payloadKg)`, `max(0, m3 − volumeM3)`.
13. `blocking`: verdadeiro se não houver linhas ou se houver algum alerta BLOCK (em linha ou no pedido).

Correspondência com o piloto, usada no teste de paridade e no cliente da API (05):

| Piloto (`issue.k` ou `status`) | Motor |
|---|---|
| `boxMult` | `QTY_NOT_MULTIPLE` |
| `blocked` | `COUNTRY_RESTRICTED` |
| `noPrice` | `NO_PRICE` |
| `belowMin` | `BELOW_MIN_LOT` |
| `missing` | `PALLET_INCOMPLETE` |
| `status: "excess"` | `VEHICLE_EXCEEDED` |
| `status: "partial"` | `VEHICLE_UNDERFILLED` |
| `pal` / `est` | `PALLETIZED` / `FLOOR` |

## Casos de referência

No pacote do motor, com a fixture do piloto (`piloto.json`, convertida por `test/piloto.ts`): é a variante "piloto" do §8. A variante "adotada" (dados do seed, com os overrides da Q12) roda no servidor, em `server/test/golden-adotado.test.ts`, contra o banco recém-semeado (04, testes). Valores conferidos por `verificar_numeros.py` e pelo `calc()` do piloto.

Pedido-teste: 3528 cx de 12031189, 300 de 12034103, 250 de 12037417 e 300 de 12144012, cliente MINOIL (lista US).

| # | Entrada | Esperado (as duas variantes, salvo indicação) |
|---|---|---|
| 1a | Pedido-teste, carreta, `PALLETIZED`, sem misto | 30 posições; `EXCEEDED`, limitante `positions` (107,1%); peso 84,1%; cubagem 81,8%; bruto 21.024,24 kg; líquido 19.230 kg; 58,88 m³; US$ 192.017,48; `over.positions` 2; faltam 24 (12034103), 23 (12037417) e 118 (12144012); 12031189 fecha pallet; sem `BELOW_MIN_LOT` |
| 1b | 1a com pallet misto | 29 posições (103,6%), `EXCEEDED` |
| 1c | 1a em contêiner 40' | posições 150%; cubagem 96,8% |
| 1d | 1a em `FLOOR`, carreta | `PARTIAL`, limitante `kg` (84,1%) |
| 1e | 1a em `FLOOR`, contêiner 40' | `FULL`, limitante `m3` (96,8%) |
| 2 | Carreta; 2352 cx de 12031189 e 1400 de 12142501 | 19 posições (67,9%), `PARTIAL`; bruto 14.468,16 kg; US$ 146.396,32 |
| 3 | Río Claro (lista AR), contêiner 40'; 1176 cx de 12031291, 140 de 12034109, 1400 de 12142501, 540 de 12147801 | Bruto 9.712,86 kg (38,9%); 33,15 m³ (54,5%); US$ 123.761,08. **Piloto:** 20 posições (100%), `FULL`. **Adotada:** 17 posições (85%), `PARTIAL`; 12034109 com 1,43 pallet e 56 cx para fechar |
| 4 | Río Claro, contêiner 40'; 110 cx de 20908885 e 560 de 12142501 | `COUNTRY_RESTRICTED` no 20908885; `BELOW_MIN_LOT` no 12142501 (2 pallets, lote 5); `blocking`. **Piloto:** 20908885 com 1,00 pallet, 3 posições. **Adotada:** 1,43 pallet, 44 cx para fechar, 4 posições |
| 5 | 50,5 cx de 12031291 (1010 UN ÷ 20) | `QTY_NOT_MULTIPLE` com `lo` 50 e `hi` 51; a linha conta 51 cx |
| 6 | Linhas vazias | `EMPTY`, sem alertas, `blocking` verdadeiro (em `dca67be` era falso; mudou em `f89cef4`) |
| 7 | Caso 2 com o 12142501 sem preço (`priceCents: null`) | `NO_PRICE` no 12142501; valor da linha 0; totais físicos iguais aos do caso 2 (19 posições, 14.468,16 kg); `blocking` |
| 8 | Empate de utilização: item sintético `T0000001` (25 kg bruto e 72 dm³ por caixa, 10 × 10 por pallet, lote 1, com preço), 500 cx na carreta em `FLOOR` | `kg` = `m3` = 0,5 exatos; limitante `kg` (o primeiro da lista); `PARTIAL` |

O caso 5 do §8 (estivada por piso) é do `engine_version` 2, fora do corte.

Comparação: kg, m³ e utilização com tolerância de 0,005 (em %, 0,05); dinheiro exato em centavos.

## Teste de paridade com o piloto

Garante que o servidor e o navegador dão o mesmo resultado enquanto a UI usar o `calc()` do HTML.

- `test/piloto.ts` lê `index.html` (raiz), normaliza `\r\n` para `\n` e extrai só as funções `calc` e `priceFor`, pelo mesmo método do `motor_piloto_harness.js` (blocos de texto avaliados com `new Function`). `P`, `VEH`, `CLIENTS`, `RULES`, `EPS` e `S` são injetados a partir da fixture, então o teste continua válido depois que os dados saírem do HTML (05, D8).
- Gera 500 pedidos com PRNG de semente fixa (mulberry32, semente 20261013): 1 a 6 SKUs, 1 a 3.000 caixas, 10% das linhas fracionárias, veículo, modo, pallet misto e cliente sorteados. Em 10% dos pedidos, um SKU sorteado perde o preço na fixture (`price = null`, sem `prices`), para exercitar `NO_PRICE` dos dois lados; os empates de limitante, raros em dados aleatórios, ficam no caso 8.
- Para cada pedido compara: posições, status, limitante, `over`, totais (bruto, líquido, m³, valor), e por linha `pallets`, `boxesToNextPallet` e o conjunto de alertas (tabela de correspondência acima). Preço do piloto: `priceFor(p, cliente)` × 100, arredondado; `null` quando o piloto marca `noPrice`.
- Se o front mudar o `calc()` do HTML, o teste falha: a mudança precisa ir também para o motor (ou virar `engine_version` 2).

**Perfil do `engine_version` 1 no `calc()` de `d84b4cf` (S7).** Desde `18e3e1a`, o `calc()` do front tem quatro diferenças de forma em relação ao de `f89cef4`, nenhuma com efeito nos padrões:
- `RULES.minLotBlock` (padrão `true`) e `RULES.fullPalBlock` (padrão `false`) decidem se `belowMin` e `missing` são erro ou aviso, editáveis na aba "Parâmetros do negócio" do modo demo. O `engine_version` 1 é o `calc()` com esses padrões: `BELOW_MIN_LOT` bloqueia e `PALLET_INCOMPLETE` só avisa. O teste injeta os dois valores por cima dos `RULES` da fixture (que segue em `f89cef4`) e confere que os padrões da linha `const RULES = {...}` do `index.html` continuam esses, com `fullAt` 0,9 e `leadDays` 7; se o front mudar o padrão, o teste falha. Um controle mostra que, com `minLotBlock: false` ou `fullPalBlock: true`, o piloto diverge do motor (a paridade enxerga a regra). No modo servidor, `PSF.applyCatalog` e `applyProducts` fixam os dois valores do perfil.
- Produto com `off` (fora de linha) gera o erro `inactive`. No servidor, material inativo não entra no catálogo efetivo e a linha é recusada com `UNKNOWN_MATERIAL` (04); a fixture não tem `off`, e um `inactive` que aparecesse na paridade seria divergência.
- `o.vsnap` (capacidade do veículo congelada na aprovação) equivale à versão gravada, imutável; a paridade não passa `vsnap`.
- Veículo desconhecido cai em `bigVeh()`; no servidor, veículo fora do contrato é 422.

A fixture é gerada por `npm run fixtures:piloto`, que lê o `index.html` do commit indicado (padrão: `f89cef4`; `PILOTO_COMMIT` troca) e grava o commit de origem, `P` (com `cxPal = lastro × alt` e `m3 = dm3 ÷ 1000`, como o piloto faz), `VEH`, `CLIENTS` e `RULES`. Não editar à mão. Desde a S7, os dados saíram do `index.html` para o `demo-data.js`: o padrão continua `f89cef4`, e um `PILOTO_COMMIT` posterior à S7 não tem os blocos que o extrator procura (falha com "bloco não encontrado").

## Motor no navegador (depois do corte)

Com a paridade verde, o motor pode ser empacotado como script clássico (`esbuild` 0.28.2, formato IIFE, global `PSFEngine`, saída em `vendor/psf-engine.js`) e o `calc()` do HTML vira um adaptador de poucas linhas. Fazer só em acordo com o front, porque mexe no arquivo que eles editam.
