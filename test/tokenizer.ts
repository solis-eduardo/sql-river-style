/**
 * Testes diretos da classificação de palavra de tokenizer.ts —
 * isProtectedFromCaseFold/quoteIdentIfNeeded/tokenize. Cobre o bug que a
 * migração pra `isProtectedFromCaseFold` corrige de vez (DROP/ALTER/INDEX
 * sem aspas dobrando pra minúsculo — commit 088d83c) e confirma, com um
 * teste, o comportamento que quase virou uma "correção" errada durante o
 * design deste candidate: `quoteIdentIfNeeded` e o ramo com aspas de
 * normalizeIdentSegment NÃO devem considerar NON_RESERVED_DDL_KEYWORDS —
 * fazer isso quotaria/preservaria aspas à toa (`drop`/`"drop"` como
 * identificador de verdade são seguros sem aspas pro Postgres).
 */
import assert from 'node:assert/strict';
import { tokenize, quoteIdentIfNeeded, isProtectedFromCaseFold } from '../src/tokenizer';

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

function identText(sql: string): string {
  const tokens = tokenize(sql).filter((t) => t.type !== 'comment' && t.type !== 'blockComment');
  return tokens[0].text;
}

// --- isProtectedFromCaseFold -------------------------------------------

// regressão do commit 088d83c: DROP/ALTER/INDEX (NON_RESERVED_DDL_KEYWORDS)
check('isProtectedFromCaseFold: DROP', isProtectedFromCaseFold('DROP'), true);
check('isProtectedFromCaseFold: ALTER', isProtectedFromCaseFold('ALTER'), true);
check('isProtectedFromCaseFold: INDEX', isProtectedFromCaseFold('INDEX'), true);
// reservada de verdade (RESERVED_KEYWORDS)
check('isProtectedFromCaseFold: SELECT', isProtectedFromCaseFold('SELECT'), true);
check('isProtectedFromCaseFold: CREATE', isProtectedFromCaseFold('CREATE'), true);
// identificador comum
check('isProtectedFromCaseFold: USUARIO não é protegida', isProtectedFromCaseFold('USUARIO'), false);

// --- tokenize: ramo sem aspas --------------------------------------------

check('tokenize: DROP solto preserva maiúscula (não é identificador de dado aqui)', identText('DROP'), 'DROP');
check('tokenize: ALTER solto preserva maiúscula', identText('ALTER'), 'ALTER');
check('tokenize: identificador comum sem aspas dobra pra minúsculo', identText('Tabela'), 'tabela');

// --- tokenize: ramo com aspas (posição de identificador inequívoca) --------

check('tokenize: "drop" entre aspas é um identificador de verdade, aspas somem com segurança', identText('"drop"'), 'drop');
check('tokenize: "Usuario" entre aspas preserva maiúscula (não é seguro tirar as aspas)', identText('"Usuario"'), '"Usuario"');

// --- quoteIdentIfNeeded: mesma posição inequívoca de "drop" entre aspas ----

check('quoteIdentIfNeeded: "drop" (alias) fica sem aspas — não é RESERVED_KEYWORDS', quoteIdentIfNeeded('drop'), 'drop');
check('quoteIdentIfNeeded: "select" (alias) precisa de aspas — é RESERVED_KEYWORDS', quoteIdentIfNeeded('select'), '"select"');

if (failures > 0) {
  console.error(`\n${failures} teste(s) de tokenizer.ts falharam.`);
  process.exit(1);
}
console.log('\ntokenizer.ts: todos os testes bateram.');
