export const searchableQuote = { clientName: 'João Café', contact: '16981234567', notes: 'Entrega na obra', items: [
  { description: 'Porta integrada 2 folhas', height: '2,30 m', width: '2,00 m', measurements: '', details: 'Preto | Vidro temperado' },
  { description: 'Janela', height: '1,20 m', width: '1,50 m', measurements: '', details: 'Branco' },
] };
export const searchCases = [
  ['', true], ['   ', true], ['joao cafe', true], ['CAFÉ', true], ['cafe joao', true], ['integrada', true], ['temperado preto', true],
  ['2,30', true], ['2.30', true], ['2.3 m', true], ['2,30 x 2,00', true], ['2.300 × 2.000', true], ['2,30Ax2,00L', true],
  ['Altura 2,30 largura 2,00', true], ['230 × 200 cm', true], ['230cm x 200cm', true], ['2300 mm x 2000 mm', true],
  ['João porta 230 cm', true], ['2,35', false], ['0,30', false], ['1,2 x 2,3', false], ['2,30 x 2,30', false],
  ['2,30 x 1,50', false], ['2,30 branco', false], ['não existe', false], ['%', false], ['_', false],
  ['16981234567', true], ['entrega obra', true], ['porta 3 folhas', false],
];

