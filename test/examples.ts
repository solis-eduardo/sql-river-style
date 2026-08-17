/**
 * Teste de regressão sobre examples/: formata cada arquivo de
 * examples/original/ com formatSql, grava o resultado num diretório
 * temporário do sistema operacional (fora do repo) e compara, byte a byte,
 * com o golden file correspondente em examples/formatted/ (gerado e
 * conferido manualmente via `npm run generate-examples`).
 *
 * É a suíte de testes inteira do formatter: casos sintéticos curtos
 * (isolando uma regra por vez) convivem aqui com SQL real vindo de várias
 * fontes da internet (ver comentário de origem no topo de cada arquivo em
 * examples/original/) — o segundo grupo pega regressões de interação entre
 * regras que um caso sintético isolado não cobre.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatSql } from '../src/formatter';
import { extractOptions } from './example-options';

const ORIGINAL_DIR = path.join(__dirname, '..', '..', 'examples', 'original');
const FORMATTED_DIR = path.join(__dirname, '..', '..', 'examples', 'formatted');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-river-style-examples-'));

const files = fs.readdirSync(ORIGINAL_DIR).filter((f) => f.endsWith('.sql')).sort();

let failures = 0;

for (const file of files) {
  const raw = fs.readFileSync(path.join(ORIGINAL_DIR, file), 'utf8');
  const { options, source } = extractOptions(raw);
  const actual = formatSql(source, options);

  // Grava no diretório temporário — é essa cópia, e não uma string em
  // memória, que é comparada ao golden file, pra exercitar o mesmo caminho
  // (formatar + persistir em disco) que `npm run generate-examples` usa pra
  // produzir examples/formatted/.
  const tmpPath = path.join(tmpDir, file);
  fs.writeFileSync(tmpPath, actual, 'utf8');

  const expectedPath = path.join(FORMATTED_DIR, file);
  if (!fs.existsSync(expectedPath)) {
    failures++;
    console.error(`FALHOU - ${file}`);
    console.error(`  não existe golden file em ${path.relative(process.cwd(), expectedPath)}.`);
    console.error(`  rode "npm run generate-examples" e confira o resultado antes de commitar.`);
    continue;
  }
  const expected = fs.readFileSync(expectedPath, 'utf8');
  const fromTmp = fs.readFileSync(tmpPath, 'utf8');

  try {
    assert.equal(fromTmp, expected);
    console.log(`ok - ${file}`);
  } catch (err) {
    failures++;
    console.error(`FALHOU - ${file}`);
    if (err instanceof assert.AssertionError) {
      console.error('  esperado (examples/formatted/):\n' + String(err.expected).split('\n').map((l) => '    ' + JSON.stringify(l)).join('\n'));
      console.error('  obtido (diretório temporário):\n' + String(err.actual).split('\n').map((l) => '    ' + JSON.stringify(l)).join('\n'));
    } else {
      console.error(err);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} de ${files.length} exemplo(s) falharam (diretório temporário: ${tmpDir}).`);
  console.error('Se a mudança de formatação for intencional, rode "npm run generate-examples", confira o diff e commite.');
  process.exit(1);
}
console.log(`\n${files.length} exemplo(s) bateram com examples/formatted/ (diretório temporário: ${tmpDir}).`);
