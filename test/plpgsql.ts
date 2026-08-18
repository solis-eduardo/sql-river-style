/**
 * Testes diretos de plpgsql.ts — feed em formatStatementList/
 * tryFormatCreateFunction/tryFormatCreateType diretamente, sem embrulhar em
 * examples/ e sem depender de golden file. Cobre os três casos que fazem
 * formatStatementList devolver `null` (bloco IF/LOOP sem terminador, BEGIN
 * ...EXCEPTION sem nenhum WHEN) — antes só alcançados por acidente através
 * de um exemplo de SQL inteiro — e o contrato de "parar no terminador de
 * quem chamou" que faz o `null` valer a pena em vez de virar um enum de
 * motivo (ver grilling de candidate 2).
 */
import assert from 'node:assert/strict';
import { tokenize } from '../src/tokenizer';
import { buildCfg } from '../src/formatter';
import { formatStatementList, tryFormatCreateFunction, tryFormatCreateType } from '../src/plpgsql';

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

function ok(name: string, condition: boolean): void {
  check(name, condition, true);
}

const cfg = buildCfg({});

function tok(sql: string) {
  return tokenize(sql).filter((t) => t.type !== 'comment' && t.type !== 'blockComment');
}

// --- formatStatementList: casos que fecham direito -------------------------

{
  const tokens = tok('x := 1;');
  const r = formatStatementList(tokens, 0, 0, cfg);
  ok('formatStatementList: atribuição simples não devolve null', r !== null);
  check('formatStatementList: consome o statement inteiro', r?.next, tokens.length);
  check('formatStatementList: renderiza a atribuição', r?.lines, ['x := 1;']);
}

{
  const tokens = tok('IF x > 0 THEN y := 1; ELSE y := 2; END IF;');
  const r = formatStatementList(tokens, 0, 0, cfg);
  ok('formatStatementList: IF/THEN/ELSE/END IF bem formado não devolve null', r !== null);
  check('formatStatementList: consome até depois do `;` final', r?.next, tokens.length);
  ok('formatStatementList: linhas incluem THEN e ELSE', !!r && r.lines.some((l) => l.trim() === 'THEN') && r.lines.some((l) => l.trim() === 'ELSE'));
  ok('formatStatementList: fecha com END IF;', !!r && r.lines[r.lines.length - 1].trim() === 'END IF;');
}

{
  const tokens = tok('FOR r IN (SELECT 1) LOOP x := r; END LOOP;');
  const r = formatStatementList(tokens, 0, 0, cfg);
  ok('formatStatementList: FOR...IN (query) LOOP bem formado não devolve null', r !== null);
  ok('formatStatementList: embute a query via cfg.render.query (sem virar fallback de uma linha)', !!r && r.lines.some((l) => l.trim() === 'SELECT 1'));
  ok('formatStatementList: fecha com END LOOP;', !!r && r.lines[r.lines.length - 1].trim() === 'END LOOP;');
}

{
  const tokens = tok('BEGIN x := 1; EXCEPTION WHEN unique_violation THEN y := 2; END;');
  const r = formatStatementList(tokens, 0, 0, cfg);
  ok('formatStatementList: BEGIN...EXCEPTION com WHEN não devolve null', r !== null);
  ok('formatStatementList: handler de EXCEPTION aparece', !!r && r.lines.some((l) => l.includes('EXCEPTION WHEN unique_violation THEN')));
}

// --- formatStatementList: contrato de "para no terminador de quem chamou" --

{
  // Um ELSE no nível de topo (sem IF ao redor, na chamada direta) não é
  // erro daqui — formatStatementList simplesmente pára ali e devolve o
  // cursor pra quem chamou decidir; quem decide se é "órfão" é o chamador
  // (formatIfStatement), não esta função.
  const tokens = tok('x := 1; ELSE y := 2;');
  const r = formatStatementList(tokens, 0, 0, cfg);
  ok('formatStatementList: para no ELSE em vez de devolver null', r !== null);
  check('formatStatementList: só renderiza até antes do ELSE', r?.lines, ['x := 1;']);
  check('formatStatementList: next aponta pro índice do ELSE', r?.next, tokens.findIndex((t) => t.upper === 'ELSE'));
}

// --- formatStatementList: os 3 jeitos de desistir com segurança (null) -----

check('formatStatementList: IF sem END IF devolve null', formatStatementList(tok('IF x > 0 THEN y := 1;'), 0, 0, cfg), null);
check('formatStatementList: LOOP sem END LOOP devolve null', formatStatementList(tok('LOOP x := 1;'), 0, 0, cfg), null);
check('formatStatementList: BEGIN...EXCEPTION sem nenhum WHEN devolve null', formatStatementList(tok('BEGIN x := 1; EXCEPTION END;'), 0, 0, cfg), null);

// --- tryFormatCreateFunction ------------------------------------------------

{
  const tokens = tok('CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;');
  const lines = tryFormatCreateFunction(tokens, cfg);
  ok('tryFormatCreateFunction: função dollar-quoted bem formada não devolve null', lines !== null);
  ok('tryFormatCreateFunction: cabeçalho reconhecido', !!lines && lines[0].startsWith('CREATE FUNCTION f()'));
}
check('tryFormatCreateFunction: statement que não é CREATE FUNCTION/PROCEDURE devolve null', tryFormatCreateFunction(tok('SELECT 1'), cfg), null);

// --- tryFormatCreateType -----------------------------------------------------

{
  const tokens = tok('CREATE TYPE t AS (a int, b text)');
  const lines = tryFormatCreateType(tokens, cfg);
  ok('tryFormatCreateType: CREATE TYPE bem formado não devolve null', lines !== null);
  check('tryFormatCreateType: um campo por linha', lines?.length, 4); // header + 2 campos + ')'
}
check('tryFormatCreateType: statement que não é CREATE TYPE devolve null', tryFormatCreateType(tok('SELECT 1'), cfg), null);

if (failures > 0) {
  console.error(`\n${failures} teste(s) de plpgsql.ts falharam.`);
  process.exit(1);
}
console.log('\nplpgsql.ts: todos os testes bateram.');
