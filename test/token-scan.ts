/**
 * Testes diretos das primitivas de varredura de token-scan.ts — sem passar
 * por formatSql nem por golden file: os casos de borda de profundidade
 * (CASE aninhado, BETWEEN...AND, parênteses desbalanceados) que antes só
 * eram exercitados por acidente através de um exemplo de SQL inteiro em
 * examples/ agora são testados aqui, contra a interface de verdade.
 */
import assert from 'node:assert/strict';
import { tokenize } from '../src/tokenizer';
import {
  DepthCursor,
  matchParen,
  findAtDepth0,
  findStatementEnd,
  hasCommaAtDepth0,
  splitAtCommaDepth0,
  splitAtSetOpDepth0,
  stripOuterParens,
} from '../src/token-scan';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepEqual(actual, expected);
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FALHOU - ${name}`);
    console.error(err);
  }
}

// tok() usa o tokenizer de verdade em vez de montar Token[] à mão — os
// testes ficam lendo como SQL, e continuam corretos se o tokenizer mudar de
// forma (novo campo em Token, etc.).
function tok(sql: string) {
  return tokenize(sql).filter((t) => t.type !== 'comment' && t.type !== 'blockComment');
}

// --- matchParen --------------------------------------------------------

check('matchParen: casa o par externo pulando o interno', matchParen(tok('(a, (b), c) resto'), 0), tok('(a, (b), c)').length);
check('matchParen: desbalanceado devolve tokens.length', matchParen(tok('(a, (b)'), 0), tok('(a, (b)').length);

// --- findAtDepth0 --------------------------------------------------------

{
  const tokens = tok('CASE WHEN x THEN 1 END THEN y');
  const idx = findAtDepth0(tokens, 0, 'THEN');
  // O primeiro THEN pertence ao CASE (dentro do caseDepth) — o de nível de
  // topo é o segundo, depois do END.
  check('findAtDepth0: pula THEN de dentro de um CASE aninhado', tokens[idx]?.upper, 'THEN');
  check('findAtDepth0: o THEN de topo é o que vem depois do END', idx, tokens.findIndex((t, i) => t.upper === 'THEN' && i > tokens.findIndex((u) => u.upper === 'END')));
}
check('findAtDepth0: não encontra devolve tokens.length', findAtDepth0(tok('a b c'), 0, 'THEN'), tok('a b c').length);

// --- findStatementEnd ------------------------------------------------------

check('findStatementEnd: acha o `;` de nível de topo, ignora o de dentro de parênteses', findStatementEnd(tok('f(1 ; 2); g'), 0), tok('f(1 ; 2)').length);

// --- hasCommaAtDepth0 / splitAtCommaDepth0 --------------------------------

check('hasCommaAtDepth0: true quando há vírgula de nível de topo', hasCommaAtDepth0(tok('a, b')), true);
check('hasCommaAtDepth0: false quando a única vírgula está entre parênteses', hasCommaAtDepth0(tok('f(a, b)')), false);
{
  const items = splitAtCommaDepth0(tok('a, b, (c, d), e')).map((item) => item.map((t) => t.text).join(''));
  check('splitAtCommaDepth0: preserva vírgula interna do item entre parênteses', items, ['a', 'b', '(c,d)', 'e']);
}
check('splitAtCommaDepth0: entrada vazia devolve [[]] (nunca [])', splitAtCommaDepth0(tok('')), [[]]);

// --- splitAtSetOpDepth0 -----------------------------------------------------

{
  const { blocks, ops } = splitAtSetOpDepth0(tok('select 1 union all select 2 except select 3'));
  check('splitAtSetOpDepth0: reconhece UNION ALL como um operador só', ops, ['UNION ALL', 'EXCEPT']);
  check('splitAtSetOpDepth0: um bloco a mais que operadores', blocks.length, ops.length + 1);
}

// --- stripOuterParens --------------------------------------------------

check('stripOuterParens: remove par duplo recursivamente', stripOuterParens(tok('((a + b))')).map((t) => t.text).join(' '), 'a + b');
check('stripOuterParens: não mexe quando os parênteses não envolvem tudo', stripOuterParens(tok('(a) + (b)')).map((t) => t.text).join(''), tok('(a) + (b)').map((t) => t.text).join(''));

// --- DepthCursor: CASE aninhado -------------------------------------------

{
  const tokens = tok('CASE WHEN a THEN CASE WHEN b THEN 1 END ELSE 2 END');
  const cursor = new DepthCursor();
  let sawNestedTop = false;
  for (const t of tokens) {
    cursor.advance(t);
    if (t.upper === 'ELSE') {
      // ainda dentro do CASE externo (caseDepth volta a 1 depois do END do
      // aninhado, nunca chega a 0 antes do fim)
      sawNestedTop = cursor.caseDepth === 1;
    }
  }
  check('DepthCursor: caseDepth volta pro nível externo depois do END do CASE aninhado', sawNestedTop, true);
  check('DepthCursor: caseDepth fecha em 0 só no END final', cursor.caseDepth, 0);
}

// --- DepthCursor: BETWEEN...AND -------------------------------------------

{
  const tokens = tok('x BETWEEN 1 AND 2 AND y = 3');
  const cursor = new DepthCursor();
  const consumedAsBetween: boolean[] = [];
  for (const t of tokens) {
    cursor.advance(t);
    if (t.upper === 'AND') {
      consumedAsBetween.push(cursor.consumeBetweenAnd(t));
    }
  }
  // primeiro AND fecha o BETWEEN; segundo AND é conector de verdade
  check('DepthCursor: só o primeiro AND depois de BETWEEN é consumido', consumedAsBetween, [true, false]);
}

if (failures > 0) {
  console.error(`\n${failures} teste(s) de token-scan.ts falharam.`);
  process.exit(1);
}
console.log('\ntoken-scan.ts: todos os testes bateram.');
