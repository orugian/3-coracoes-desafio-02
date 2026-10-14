// Contratos (docs/specs/04-api.md, "Contratos"): os JSON Schema versionados em docs/specs/schemas/ estão em dia com o zod,
// e os schemas de saída são estritos (campo fora do contrato falha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CustomerProfile, PortalCatalog, PortalOrderView } from '#contracts';
import { renderJsonSchemas } from '../src/json-schema.ts';

const DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'docs', 'specs', 'schemas');

test('docs/specs/schemas/ tem exatamente os schemas gerados (rode npm run contracts:schema se falhar)', () => {
  const rendered = renderJsonSchemas();
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(onDisk, [...rendered.keys()].sort());
  for (const [name, content] of rendered) {
    assert.equal(readFileSync(path.join(DIR, name), 'utf8'), content, `${name} desatualizado`);
  }
});

test('os schemas de saída do portal não aceitam campo extra, nem aninhado', () => {
  const profile = {
    code: '1', slug: 's', name: 'n', destinationLabel: 'd', currency: 'USD', incoterm: 'FCA', paymentCode: 'p', paymentTerms: 't',
    priceList: 'US', plant: '2612', plantName: 'CD', branch: 'LONT', contactName: null, language: 'pt', mixedPallet: false,
  };
  assert.ok(CustomerProfile.safeParse(profile).success, 'controle');
  assert.ok(!CustomerProfile.safeParse({ ...profile, autoApprove: false }).success);
  const catalog = { engineVersion: 1, customer: { ...profile, restrictedMaterials: [] }, rules: { fullAt: 0.9, leadDays: 7 }, vehicles: [], items: [] };
  assert.ok(PortalCatalog.safeParse(catalog).success, 'controle');
  assert.ok(!PortalCatalog.safeParse({ ...catalog, customer: { ...catalog.customer, country: 'AR' } }).success);
  assert.ok(!PortalCatalog.safeParse({ ...catalog, rules: { ...catalog.rules, internal: 1 } }).success);
  const json = JSON.parse(readFileSync(path.join(DIR, 'PortalOrderView.json'), 'utf8')) as { additionalProperties?: boolean };
  assert.equal(json.additionalProperties, false, 'o JSON Schema também é estrito');
  assert.ok(PortalOrderView);
});
