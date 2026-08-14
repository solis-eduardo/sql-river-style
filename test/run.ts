import assert from 'node:assert/strict';
import { formatSql } from '../src/formatter';

interface Case {
  name: string;
  input: string;
  expected: string;
}

const cases: Case[] = [
  {
    name: 'river style básico + uma coluna por linha + sem ; final',
    input: `select tabela.coluna1, tabela.coluna2 from tabela where tabela.coluna1 = 1 and tabela.coluna2 = 2 order by tabela.coluna1`,
    expected: [
      '    SELECT tabela.coluna1,',
      '           tabela.coluna2',
      '      FROM tabela',
      '     WHERE tabela.coluna1 = 1',
      '       AND tabela.coluna2 = 2',
      '  ORDER BY tabela.coluna1',
      '',
    ].join('\n'),
  },
  {
    name: 'INNER JOIN define a coluna do river + ON entre parênteses + função nativa maiúscula',
    input: `SELECT ecm_conteudo.id,
              ecm_conteudo.nome,
              count(ecm_assinatura.id) as total_assinaturas
         FROM ecm_conteudo
         INNER JOIN ecm_assinatura on ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id
        WHERE ecm_conteudo.categoria_id = 10
          AND ecm_conteudo.ativo = true
        GROUP BY ecm_conteudo.id, ecm_conteudo.nome
        ORDER BY ecm_conteudo.nome`,
    expected: [
      '    SELECT ecm_conteudo.id,',
      '           ecm_conteudo.nome,',
      '           COUNT(ecm_assinatura.id) as total_assinaturas',
      '      FROM ecm_conteudo',
      'INNER JOIN ecm_assinatura',
      '        ON ( ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id )',
      '     WHERE ecm_conteudo.categoria_id = 10',
      '       AND ecm_conteudo.ativo = TRUE',
      '  GROUP BY ecm_conteudo.id,',
      '           ecm_conteudo.nome',
      '  ORDER BY ecm_conteudo.nome',
      '',
    ].join('\n'),
  },
  {
    name: 'CTEs encadeadas sem indentação + AS maiúsculo só no cabeçalho da CTE + cast maiúsculo',
    input: `with primeira_cte as (
        select a.id, a.valor::numeric from tabela_a a
    ), segunda_cte as (
        select b.id from tabela_b b
    )
    select primeira_cte.id, segunda_cte.id from primeira_cte inner join segunda_cte on primeira_cte.id = segunda_cte.id`,
    expected: [
      'WITH primeira_cte AS (',
      '    SELECT a.id,',
      '           a.valor::NUMERIC',
      '      FROM tabela_a a',
      '), segunda_cte AS (',
      '    SELECT b.id',
      '      FROM tabela_b b',
      ')',
      '',
      '    SELECT primeira_cte.id,',
      '           segunda_cte.id',
      '      FROM primeira_cte',
      'INNER JOIN segunda_cte',
      '        ON ( primeira_cte.id = segunda_cte.id )',
      '',
    ].join('\n'),
  },
  {
    name: 'UNION ALL com linha em branco antes/depois + BETWEEN...AND não quebra linha',
    input: `select a.id from tabela_a a where a.total between 1 and 10
       union all
       select b.id from tabela_b b`,
    expected: [
      '    SELECT a.id',
      '      FROM tabela_a a',
      '     WHERE a.total BETWEEN 1 AND 10',
      '',
      ' UNION ALL',
      '',
      '    SELECT b.id',
      '      FROM tabela_b b',
      '',
    ].join('\n'),
  },
  {
    name: 'comentário standalone na coluna 1 + comentário trailing não engole o fechamento do ON',
    input: `-- total de assinaturas por categoria
      select categoria.nome, count(*) as total
      from categoria
      left join assinatura on assinatura.categoria_id = categoria.id -- só ativas
      where categoria.ativo = true
      group by categoria.nome`,
    expected: [
      '-- total de assinaturas por categoria',
      '    SELECT categoria.nome,',
      '           COUNT(*) as total',
      '      FROM categoria',
      ' LEFT JOIN assinatura',
      '        ON ( assinatura.categoria_id = categoria.id ) -- só ativas',
      '     WHERE categoria.ativo = TRUE',
      '  GROUP BY categoria.nome',
      '',
    ].join('\n'),
  },
  {
    name: 'comentário standalone entre colunas do SELECT fica entre elas, não no topo',
    input: `select t.id,
              -- comentário entre colunas
              t.nome
       from tabela t`,
    expected: ['    SELECT t.id,', '-- comentário entre colunas', '           t.nome', '      FROM tabela t', ''].join(
      '\n',
    ),
  },
  {
    name: 'subquery em FROM formatada recursivamente com indentação própria',
    input: `select id from (select tabela.id from tabela where tabela.ativo = true) sub where sub.id > 0`,
    expected: [
      '    SELECT id',
      '      FROM (',
      '    SELECT tabela.id',
      '      FROM tabela',
      '     WHERE tabela.ativo = TRUE',
      ') sub',
      '     WHERE sub.id > 0',
      '',
    ].join('\n'),
  },
  {
    name: 'múltiplos statements: ; entre eles, nenhum no final do arquivo',
    input: `select 1;\n\n   select 2`,
    expected: ['    SELECT 1;', '', '    SELECT 2', ''].join('\n'),
  },
  {
    name: 'sinal de menos unário não vira operador binário com espaço',
    input: `select t.id from tabela t where t.saldo < -1000`,
    expected: ['    SELECT t.id', '      FROM tabela t', '     WHERE t.saldo < -1000', ''].join('\n'),
  },
  {
    name: 'additionalFunctions maiusculiza função de negócio configurada',
    input: `select fn_calcula_total(t.id) as total from tabela t`,
    expected: ['    SELECT FN_CALCULA_TOTAL(t.id) as total', '      FROM tabela t', ''].join('\n'),
  },
  {
    name: 'casts de tipo composto (mais de uma palavra) ficam totalmente maiúsculos',
    input: `select t.a::double precision,
                   t.b::character varying(255),
                   t.c::timestamp with time zone,
                   t.d::timestamp without time zone,
                   t.e::int
              from t`,
    expected: [
      '    SELECT t.a::DOUBLE PRECISION,',
      '           t.b::CHARACTER VARYING(255),',
      '           t.c::TIMESTAMP WITH TIME ZONE,',
      '           t.d::TIMESTAMP WITHOUT TIME ZONE,',
      '           t.e::INT',
      '      FROM t',
      '',
    ].join('\n'),
  },
  {
    name: 'UPDATE ... SET (lista) ... WHERE com river próprio',
    input: `update ecm_conteudo set nome = 'novo nome', ativo = true where ecm_conteudo.id = 1 and ecm_conteudo.categoria_id = 2`,
    expected: [
      'UPDATE ecm_conteudo',
      "   SET nome = 'novo nome',",
      '       ativo = TRUE',
      ' WHERE ecm_conteudo.id = 1',
      '   AND ecm_conteudo.categoria_id = 2',
      '',
    ].join('\n'),
  },
  {
    name: 'UPDATE ... FROM (extensão Postgres) reaproveita marker de FROM',
    input: `update ecm_conteudo set nome = origem.nome from origem where ecm_conteudo.id = origem.id`,
    expected: [
      'UPDATE ecm_conteudo',
      '   SET nome = origem.nome',
      '  FROM origem',
      ' WHERE ecm_conteudo.id = origem.id',
      '',
    ].join('\n'),
  },
  {
    name: 'DELETE FROM / WHERE como duas cláusulas río separadas, igual SELECT/FROM',
    input: `delete from ecm_conteudo where ecm_conteudo.id = 1`,
    expected: ['DELETE', '  FROM ecm_conteudo', ' WHERE ecm_conteudo.id = 1', ''].join('\n'),
  },
  {
    name: 'DELETE ... USING (tabela, sem parênteses) ... RETURNING',
    input: `delete from ecm_conteudo using ecm_categoria where ecm_conteudo.categoria_id = ecm_categoria.id and ecm_categoria.ativo = false returning ecm_conteudo.id`,
    expected: [
      '   DELETE',
      '     FROM ecm_conteudo',
      '    USING ecm_categoria',
      '    WHERE ecm_conteudo.categoria_id = ecm_categoria.id',
      '      AND ecm_categoria.ativo = FALSE',
      'RETURNING ecm_conteudo.id',
      '',
    ].join('\n'),
  },
  {
    name: 'INSERT INTO ... VALUES com múltiplas tuplas + RETURNING, espaço antes da lista de colunas',
    input: `insert into ecm_conteudo (nome, categoria_id) values ('a', 1), ('b', 2) returning id`,
    expected: [
      'INSERT INTO ecm_conteudo (nome, categoria_id)',
      "     VALUES ('a', 1),",
      "            ('b', 2)",
      '  RETURNING id',
      '',
    ].join('\n'),
  },
  {
    name: 'INSERT INTO ... SELECT compartilha o mesmo river do INSERT INTO',
    input: `insert into ecm_conteudo (nome, categoria_id) select origem.nome, origem.categoria_id from origem where origem.ativo = true`,
    expected: [
      'INSERT INTO ecm_conteudo (nome, categoria_id)',
      '     SELECT origem.nome,',
      '            origem.categoria_id',
      '       FROM origem',
      '      WHERE origem.ativo = TRUE',
      '',
    ].join('\n'),
  },
  {
    name: 'identificadores entre aspas encadeados ("tabela"."coluna") preservam o ponto e tiram aspas desnecessárias',
    input: `select *
       from "ecm_versoes"
       inner join "ecm_arquivos"
       on "ecm_versoes"."arquivo_id" = "ecm_arquivos"."id"
       where "ecm_arquivos"."deleted_at" is null
       and "ecm_arquivos"."anexo" = true`,
    expected: [
      '    SELECT *',
      '      FROM ecm_versoes',
      'INNER JOIN ecm_arquivos',
      '        ON ( ecm_versoes.arquivo_id = ecm_arquivos.id )',
      '     WHERE ecm_arquivos.deleted_at IS NULL',
      '       AND ecm_arquivos.anexo = TRUE',
      '',
    ].join('\n'),
  },
  {
    name: 'identificador entre aspas só fica quando é necessário: maiúscula/acento/espaço/keyword reservada mantêm, o resto tira',
    input: `select "Tabela"."coluna_simples", tabela."Coluna Com Espaço", tabela."situação", tabela."order" from "Tabela"`,
    expected: [
      '    SELECT "Tabela".coluna_simples,',
      '           tabela."Coluna Com Espaço",',
      '           tabela."situação",',
      '           tabela."order"',
      '      FROM "Tabela"',
      '',
    ].join('\n'),
  },
  {
    // "user"/"table"/"check" não estavam na lista curada (KEYWORD_SET) usada
    // antes pra essa checagem — a lista de reservadas do Postgres é bem mais
    // ampla, e sem ela o formatter tirava as aspas incorretamente.
    name: 'palavra reservada do Postgres fora da lista curada de keywords do formatter mantém aspas',
    input: `select "user", "table", "check" from tabela.tabela`,
    expected: ['    SELECT "user",', '           "table",', '           "check"', '      FROM tabela.tabela', ''].join(
      '\n',
    ),
  },
  {
    name: 'placeholder de bind parameter (?) do log de query do Laravel não é descartado',
    input: `select count(*) as aggregate from "ecm_versoes" where "ecm_versoes"."disco" = ? and "ecm_versoes"."ativo" = ?`,
    expected: [
      '    SELECT COUNT(*) as aggregate',
      '      FROM ecm_versoes',
      '     WHERE ecm_versoes.disco = ?',
      '       AND ecm_versoes.ativo = ?',
      '',
    ].join('\n'),
  },
  {
    name: 'CASE WHEN/THEN em blocos, um por linha, e END alinhado com o CASE',
    input: `select a.id from tabela a where a.status <> 42 and case when x = '' then true when x = 'a' -- Arquivados
       then a.status_id = 41 when x = 't' then b.is_closed is true and a.status_id not in (1,2) end`,
    expected: [
      '    SELECT a.id',
      '      FROM tabela a',
      '     WHERE a.status <> 42',
      "       AND CASE WHEN x = ''",
      '                THEN TRUE',
      "                WHEN x = 'a' -- Arquivados",
      '                THEN a.status_id = 41',
      "                WHEN x = 't'",
      '                THEN b.is_closed IS TRUE AND a.status_id NOT IN (1, 2)',
      '           END',
      '',
    ].join('\n'),
  },
  {
    name: 'CASE dentro de item de SELECT (não só em condição) também quebra em blocos',
    input: `select case when a.status = 1 then 'ativo' else 'inativo' end as status_desc, a.id from tabela a`,
    expected: [
      '    SELECT CASE WHEN a.status = 1',
      "                THEN 'ativo'",
      "                ELSE 'inativo'",
      '           END as status_desc,',
      '           a.id',
      '      FROM tabela a',
      '',
    ].join('\n'),
  },
  {
    name: 'ON com múltiplas condições (parênteses já no fonte) quebra uma por linha, alinhada sob a primeira',
    input: `select a.id from tabela_a a inner join tabela_b b on ( a.x = b.x and a.y = b.y )`,
    expected: [
      '    SELECT a.id',
      '      FROM tabela_a a',
      'INNER JOIN tabela_b b',
      '        ON ( a.x = b.x',
      '         AND a.y = b.y )',
      '',
    ].join('\n'),
  },
  {
    name: 'ON sem parênteses no fonte (AND vira marker solto) é reincorporado e quebrado igual',
    input: `select a.id from tabela_a a inner join tabela_b b on a.x = b.x and a.y = b.y where a.ativo = true`,
    expected: [
      '    SELECT a.id',
      '      FROM tabela_a a',
      'INNER JOIN tabela_b b',
      '        ON ( a.x = b.x',
      '         AND a.y = b.y )',
      '     WHERE a.ativo = TRUE',
      '',
    ].join('\n'),
  },
  {
    name: 'keyword interval sai maiúscula',
    input: `select a.id from tabela a where a.criado_em <= CURRENT_TIMESTAMP - interval '0 days'`,
    expected: [
      '    SELECT a.id',
      '      FROM tabela a',
      "     WHERE a.criado_em <= CURRENT_TIMESTAMP - INTERVAL '0 days'",
      '',
    ].join('\n'),
  },
  {
    // Regra confirmada pelo usuário: SELECT nunca fica com menos de 4
    // espaços antes dela, mesmo quando é a keyword mais longa da query
    // (ex.: um SELECT sem JOIN cuja cláusula mais longa é GROUP BY, que
    // sozinha só pediria 2 espaços).
    name: 'SELECT mantém pelo menos 4 espaços de indentação mesmo sem JOIN mais largo que GROUP BY',
    input: `SELECT COUNT(*), categoria_id FROM ecm_versoes
JOIN ecm_arquivos ON(ecm_versoes.arquivo_id = ecm_arquivos.id)
WHERE ecm_versoes.deleted_at IS NULL
 AND ecm_arquivos.deleted_at IS NOT NULL
 AND categoria_id = 59
 GROUP BY 2`,
    expected: [
      '    SELECT COUNT(*),',
      '           categoria_id',
      '      FROM ecm_versoes',
      '      JOIN ecm_arquivos',
      '        ON ( ecm_versoes.arquivo_id = ecm_arquivos.id )',
      '     WHERE ecm_versoes.deleted_at IS NULL',
      '       AND ecm_arquivos.deleted_at IS NOT NULL',
      '       AND categoria_id = 59',
      '  GROUP BY 2',
      '',
    ].join('\n'),
  },
];

let failures = 0;

for (const c of cases) {
  const extra = c.name.includes('additionalFunctions') ? { additionalFunctions: ['fn_calcula_total'] } : {};
  try {
    const actual = formatSql(c.input, extra);
    assert.equal(actual, c.expected);
    console.log(`ok - ${c.name}`);
  } catch (err) {
    failures++;
    console.error(`FALHOU - ${c.name}`);
    if (err instanceof assert.AssertionError) {
      console.error('  esperado:\n' + String(err.expected).split('\n').map((l) => '    ' + JSON.stringify(l)).join('\n'));
      console.error('  obtido:\n' + String(err.actual).split('\n').map((l) => '    ' + JSON.stringify(l)).join('\n'));
    } else {
      console.error(err);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} de ${cases.length} teste(s) falharam.`);
  process.exit(1);
}
console.log(`\n${cases.length} teste(s) passaram.`);
