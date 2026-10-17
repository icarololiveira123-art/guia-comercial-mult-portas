import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogMatchesSearch, matchesSearch, quoteMatchesSearch, searchTokens } from '../app/lib/search.mjs';
import { catalogItems } from '../app/lib/catalog-items.mjs';

import { searchableQuote, searchCases } from './fixtures/search-cases.mjs';

test('quote search matches clients, products and equivalent dimensions without combining different items', () => {
  for (const [query, expected] of searchCases) assert.equal(quoteMatchesSearch(searchableQuote, query), expected, query);
});

test('search accepts legacy free measurements and independently optional dimensions without altering data', () => {
  const legacy = { clientName: 'Antigo', items: [{ description: 'Porta', measurements: '230A x 200L cm' }] };
  // Explicit units for an entire pair, with optional orientation letters.
  const free = { clientName: 'Antigo', items: [{ description: 'Porta', measurements: '230 × 200 cm' }] };
  for (const record of [searchableQuote, free]) {
    const before = structuredClone(record);
    assert.equal(quoteMatchesSearch(record, '2,30 x 2,00'), true);
    assert.deepEqual(record, before);
  }
  assert.equal(quoteMatchesSearch({ clientName: 'Antigo', items: [{ description: 'Porta', measurements: '2,30Ax2,00L' }] }, '2.3 x 2'), true);
  assert.equal(quoteMatchesSearch({ clientName: 'Só altura', items: [{ description: 'Porta', height: '2,30' }] }, '230 cm'), true);
  assert.equal(quoteMatchesSearch({ clientName: 'Sem medidas', items: [{ description: 'Porta 2 folhas' }] }, '2,00'), false);
  assert.equal(quoteMatchesSearch(legacy, 'Antigo'), true);
});

test('normalization preserves numeric precision, zeros, literal punctuation and product descriptions', () => {
  assert.deepEqual(searchTokens('CAFÉ 230 × 200 cm'), ['w:cafe','n:2.3','n:2']);
  assert.deepEqual(searchTokens('0,001 m 1mm 0,1 cm'), ['n:0.001','n:0.001','n:0.001']);
  assert.deepEqual(searchTokens('2 x 4 Madeira'), ['n:2','n:4','w:madeira']);
  assert.deepEqual(searchTokens('0,00'), ['n:0']);
  assert.equal(matchesSearch('2,35 m', '2,3'), false);
  assert.equal(matchesSearch('Janela 1,20 × 1,20 m', '1,20 x 1,20'), true);
  assert.equal(matchesSearch('Janela 1,20 × 1,50 m', '1,20 x 1,20'), false);
});

test('phone search ignores punctuation and optional Brazilian country code without changing the contact', () => {
  for (const contact of ['16981234567','(16) 98123-4567','+55 (16) 98123-4567','55 16 98123 4567']) {
    const record = { clientName: 'Cliente', contact, items: [{ description: 'Porta', height: '2,30 m' }] };
    const before = structuredClone(record);
    for (const query of ['16981234567','(16) 98123-4567','+55 16 98123 4567','981234567','4567']) assert.equal(quoteMatchesSearch(record,query),true,`${contact}: ${query}`);
    for (const query of ['(11) 98123-4567','98123-0000','2,35','2.300']) assert.equal(quoteMatchesSearch({ ...record, items: [] },query),false,query);
    assert.equal(quoteMatchesSearch(record,'2.30'),true);
    assert.deepEqual(record,before);
  }
});

test('catalog search finds codes, accent-insensitive words and dimensions in all searchable commercial fields', () => {
  const item = { title: 'Vitrô maxim-ar', family: 'Alumínio', code: 'VTR-340', spec: '120 × 150 cm', bestFor: 'Ventilação da cozinha', checks: ['Vidro temperado'] };
  for (const query of ['VTR-340', 'aluminio', 'maxim ar', '1,20 x 1,50', '1200 mm x 1500 mm', 'ventilacao cozinha', 'vidro']) assert.equal(catalogMatchesSearch(item, query), true, query);
  assert.equal(catalogMatchesSearch(item, '1,20 x 1,20'), false);
  assert.equal(catalogMatchesSearch(item, 'inox'), false);
  for (const record of catalogItems) {
    assert.equal(catalogMatchesSearch(record, ''), true, record.id);
    assert.equal(catalogMatchesSearch(record, record.title), true, record.id);
  }
});
