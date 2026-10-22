const {test}=require('node:test');
const assert=require('node:assert/strict');
const limits=import('../app/web/processing-limits.mjs');

test('rejeita PDFs e páginas acima dos limites de processamento',async()=>{
  const {LIMITS,checkPageCount,checkTextContent}=await limits;
  checkPageCount(LIMITS.pages);
  for(const count of [0,-1,NaN,Infinity,LIMITS.pages+1])assert.throws(()=>checkPageCount(count),/até.*páginas/);
  assert.throws(()=>checkTextContent({items:new Array(LIMITS.textItems+1)}),/texto demais/);
  const {groupWords}=await import('../app/web/detector.mjs');
  assert.throws(()=>groupWords(new Array(LIMITS.textItems+1)),/texto demais/);
});

test('timeout interrompe operação pendente e não interrompe a já concluída',async()=>{
  const {withinTime}=await limits;
  let canceled=0;
  await assert.rejects(withinTime(new Promise(()=>{}),10,()=>canceled++),{name:'TimeoutError'});
  assert.equal(canceled,1);
  assert.equal(await withinTime(Promise.resolve('ready'),10,()=>canceled++),'ready');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(canceled,1);
});
