// Decisões do time usadas pelo seed (docs/specs/03-seed.md e §7.3/§15 da arquitetura). Este arquivo é uma fonte:
// o seed grava o sha256 dele num import_batch DECISOES. Mudar um valor aqui é mudar uma decisão; registrar o motivo no PR.

export const DECISION_AT = '2026-10-13T12:00:00-03:00'; // decisões aprovadas pelo time em 13/10
export const EXPORT_CHANNEL = '13'; // Exportação, o único canal dos exports do SAP

// Filial → centro. Só LONT → 2612 é conhecido; BHO e NAT não têm centro nos exports (premissa).
export const BRANCHES = [{ branch: 'LONT', plant: '2612', isAssumption: true }] as const;

// Q6: preço dos 3 SKUs sem registro no SAP, do site da 3corações (lista US). priceRaw = valor antes de arredondar.
export const SITE_3C_PRICES = {
  priceList: 'US', plant: '2612', currency: 'USD', validFrom: '2026-01-01', validTo: '9999-12-31',
  items: [
    { material: '12034109', price: 36.96, priceRaw: null },
    { material: '12037417', price: 29.48, priceRaw: null },
    { material: '20908885', price: 17.61, priceRaw: 17.611 },
  ],
} as const;

// Lista AR de demonstração (cliente Río Claro): US × 1,06 com o arredondamento do piloto (Math.round), mesma vigência da US.
export const DEMO_PRICE_LIST = { priceList: 'AR', fromList: 'US', factor: 1.06 } as const;

// Q4: posições de pallet por veículo (artefato 3C Conecta). Cubagem e carga útil vêm do dados/container.json.
export const VEHICLE_POSITIONS = [
  { id: 'carreta_padrao', palletPositions: 28, sortOrder: 1 },
  { id: 'container_40', palletPositions: 20, sortOrder: 2 },
  { id: 'container_20', palletPositions: 10, sortOrder: 3 },
] as const;
export const VEHICLE_POSITIONS_SOURCE = 'artefato 3C Conecta (Q4)';

// MINOIL: o cadastro vem da OB; estes campos vêm do piloto (CLIENTS.minoil), para a demo não mudar.
export const MINOIL = { code: '11131', pilotKey: 'minoil', defaultLanguage: 'pt', country: null } as const;

// Cliente de demonstração, copiado do piloto (CLIENTS.rioclaro).
export const RIO_CLARO = {
  code: '11999', slug: 'rioclaro', name: 'Distribuidora Río Claro S.R.L.', country: 'AR', destinationLabel: 'Argentina',
  currency: 'USD', incoterm: 'FCA', paymentCode: '0030', paymentTerms: 'Antecipado 30 dias', priceList: 'AR', branch: 'LONT',
  contactName: 'Sofía', language: 'es', mixedPallet: false, autoApprove: false, isDemo: true,
} as const;

// Q5: restrição de demonstração do piloto.
export const COUNTRY_RULES = [
  { country: 'AR', customerCode: '11999', material: '20908885', kind: 'BLOCK', reason: 'Regra de demonstração do piloto (Q5)', isDemo: true },
] as const;

export const USERS = [
  { username: 'martin.minoil', role: 'ext_distribuidor', displayName: 'Martín (MINOIL S.A.)', customers: ['11131'] },
  { username: 'sofia.rioclaro', role: 'ext_distribuidor', displayName: 'Sofía (Distribuidora Río Claro S.R.L.)', customers: ['11999'] },
  { username: 'lucas.exportacao', role: 'int_exportacao', displayName: 'Lucas (Exportação)', customers: [] },
  { username: 'ana.exportacao', role: 'int_exportacao', displayName: 'Ana (Exportação)', customers: [] },
  { username: 'admin.dados', role: 'int_admin', displayName: 'Administração de dados', customers: [] },
] as const;

// §7.3: overrides do dado mestre. sapValue é o valor esperado no SAP: se o export mudar, o seed para.
export const OVERRIDES = [
  {
    entity: 'material_uom', material: '12147801', keyPart: 'CX', field: 'gross_kg', sapValue: 0.00089, adoptedValue: 1.2, decisionRef: 'Q9',
    justification: 'SAP com unidade trocada (0,89 G); valor do piloto e escolha conservadora para o limite de peso',
  },
  {
    entity: 'palletization', material: '12034109', keyPart: '2612', field: 'layer_boxes', sapValue: 4, adoptedValue: 14, decisionRef: 'Q12',
    justification: 'Heurística do time (Q12): TAB e PALETIZAÇÃO dão 98 = 14 × 7; lastro 4 cobre 28,4% da base',
  },
  {
    entity: 'palletization', material: '20908885', keyPart: '2612', field: 'layers', sapValue: 10, adoptedValue: 7, decisionRef: 'Q12',
    justification: 'Heurística do time (Q12): PALETIZAÇÃO dá 77 = 11 × 7; 10 camadas passam de 2.393 mm',
  },
] as const;
export const OVERRIDE_PROPOSED_BY = 'admin.dados';
export const OVERRIDE_CONFIRMED_BY = 'ana.exportacao';

// Pedidos de exemplo (03, "Pedidos de exemplo"). Datas em −03:00; o preço é o vigente na data de cada versão.
// lines: 'pedido.json' = itens e caixas do dados/pedido.json. changes: ajustes da Exportação sobre a versão anterior.
export interface SeedOrderVersion {
  at: string;
  author: string;
  lines?: 'pedido.json' | { material: string; boxes: number }[];
  changes?: { material: string; boxes: number }[];
  reason?: string;
}
export interface SeedOrder {
  id: string;
  customer: string;
  origin: 'PORTAL' | 'ORDER_BASIS' | 'BACKOFFICE';
  vehicleId: string;
  loadMode: 'PALLETIZED' | 'FLOOR';
  reference: string | 'pedido.json';
  loadingDate: string | null;
  versions: SeedOrderVersion[];
  approval: { at: string; by: string } | null;
}

export const ORDERS: SeedOrder[] = [
  {
    id: '3CC-2026-0001', customer: '11131', origin: 'ORDER_BASIS', vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED',
    reference: 'pedido.json', loadingDate: null,
    versions: [{ at: '2026-10-09T17:53:00-03:00', author: 'lucas.exportacao', lines: 'pedido.json', reason: 'Importado da planilha Order Basis; a planilha indicava embarque OK' }],
    approval: null,
  },
  {
    id: '3CC-2026-0002', customer: '11131', origin: 'PORTAL', vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED',
    reference: 'OC-2026-097', loadingDate: '2026-10-24',
    versions: [
      { at: '2026-10-11T09:12:00-03:00', author: 'martin.minoil', lines: [
        { material: '12031189', boxes: 2688 }, { material: '12034103', boxes: 324 }, { material: '12142146', boxes: 600 }, { material: '12037417', boxes: 182 },
      ] },
      { at: '2026-10-11T11:31:00-03:00', author: 'lucas.exportacao', changes: [{ material: '12034103', boxes: 405 }], reason: 'completar a carreta' },
    ],
    approval: { at: '2026-10-11T11:40:00-03:00', by: 'ana.exportacao' },
  },
  {
    id: '3CC-2026-0003', customer: '11999', origin: 'PORTAL', vehicleId: 'container_40', loadMode: 'PALLETIZED',
    reference: 'OC-4471', loadingDate: '2026-11-03',
    versions: [{ at: '2026-10-12T10:21:00-03:00', author: 'sofia.rioclaro', lines: [
      { material: '12031291', boxes: 1176 }, { material: '12034109', boxes: 140 }, { material: '12142501', boxes: 1400 }, { material: '12147801', boxes: 540 },
    ] }],
    approval: { at: '2026-10-12T14:05:00-03:00', by: 'lucas.exportacao' },
  },
];
