# Competo SQL Formatter

Extensão VSCode que formata arquivos `.sql` seguindo o estilo house
("river style") usado no Competo para SQL escrito à mão — queries de
relatório, scripts avulsos, campos `sql` de `objetos`/`paineis` exportados
para `.sql`. Não é um formatter genérico/configurável: reproduz um
conjunto fixo de convenções confirmadas pelo usuário.

## Regras aplicadas

1. **Keywords alinhadas à direita ("river style")**: `SELECT`, `FROM`,
   `WHERE`, `AND`/`OR`, `INNER/LEFT/RIGHT/FULL/CROSS JOIN`, `ON`/`USING`,
   `UNION ALL`, `GROUP BY`, `ORDER BY`, `HAVING`, `LIMIT`, `OFFSET` — e, em
   DML, `INSERT INTO`, `UPDATE`, `SET`, `DELETE`, `VALUES`, `RETURNING` —
   terminam todas na mesma coluna, definida pela keyword mais longa em uso
   naquela query/statement. Quando o bloco tem um `SELECT`, ele nunca fica
   com menos de 4 espaços de indentação antes dele — mesmo que `SELECT`
   por si só já fosse a keyword mais longa em uso (ex.: um `SELECT` sem
   `JOIN` cuja cláusula mais longa é `GROUP BY`, que sozinha só pediria 2
   espaços).
2. **Uma coluna por linha** em `SELECT`, `GROUP BY`, `ORDER BY` — e também
   em `SET` (uma atribuição por linha), `VALUES` (uma tupla por linha) e
   `RETURNING` —, alinhadas verticalmente sob o primeiro item da lista.
3. **Alias de tabela**: o formatter não adiciona nem remove alias — só
   reformata o que está escrito. A convenção de evitar alias (exceto em
   self-join) é responsabilidade de quem escreve a query.
4. **Maiúsculo**: palavras-chave SQL, funções nativas reconhecidas
   (`COUNT`, `UNNEST`, `ARRAY_LENGTH`, `COALESCE`...) e casts (`::INT`,
   `::TEXT`). **Minúsculo**: `as` de alias de coluna. Alias de CTE usa `AS`
   maiúsculo (única exceção).
5. Condição de `JOIN` entre parênteses, em linha própria após `ON`:
   `ON ( a.x = b.y )`. Com mais de uma condição, cada `AND`/`OR` quebra
   linha dentro dos parênteses, alinhado sob a primeira condição — vale
   tanto pra quem já escreve `ON ( a.x = b.x AND a.y = b.y )` quanto pra
   quem escreve sem parênteses (`ON a.x = b.x AND a.y = b.y`), os dois
   formatam igual. `USING` não ganha esse wrap — serve tanto a forma
   `USING (col1, col2)` de `JOIN` quanto a forma `USING outra_tabela` de
   `DELETE` multi-tabela do Postgres, e por isso fica como está.
6. `CASE`/`WHEN`/`THEN`/`ELSE`/`END` em blocos: o primeiro `WHEN` fica na
   mesma linha do `CASE`, cada `WHEN`/`THEN`/`ELSE` seguinte vira sua
   própria linha alinhada logo depois de `CASE ` (mesma coluna do
   primeiro `WHEN`), e `END` fecha alinhado com o próprio `CASE`. Vale
   tanto num item de `SELECT` quanto numa condição de `WHERE`/`ON`/etc.
7. Linha em branco separando `UNION ALL`/`UNION`/`EXCEPT`/`INTERSECT` do
   que vem antes/depois, e separando definições de CTEs entre si.
8. CTEs encadeadas sem indentação: fechamento de uma e abertura da
   próxima na mesma linha (`), proxima_cte AS (`).
9. Comentários `--` standalone (sozinhos na linha) sempre na coluna 1, sem
   indentação — mesmo dentro de CTEs/subqueries. Comentários no fim de uma
   linha de código permanecem no fim dessa linha.
10. Sem `;` no final do arquivo (a query é tratada como fragmento). Em
    arquivos com múltiplos statements, o `;` entre eles é mantido — só o
    último é removido.

Exemplo:

```sql
    SELECT ecm_conteudo.id,
           ecm_conteudo.nome,
           COUNT(ecm_assinatura.id) as total_assinaturas
      FROM ecm_conteudo
INNER JOIN ecm_assinatura
        ON ( ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id )
     WHERE ecm_conteudo.categoria_id = 10
       AND ecm_conteudo.ativo = TRUE
  GROUP BY ecm_conteudo.id,
           ecm_conteudo.nome
  ORDER BY ecm_conteudo.nome
```

`ON` com mais de uma condição quebra uma por linha (funciona igual se o
`AND`/`OR` já vier entre parênteses no fonte ou não):

```sql
    SELECT issues.id
      FROM issues
INNER JOIN custom_values campo_nome
        ON ( campo_nome.customized_id = issues.id
         AND campo_nome.custom_field_id = 109 )
```

`CASE`/`WHEN`/`THEN` em blocos, um por linha (funciona tanto num item de
`SELECT` quanto dentro de uma condição de `WHERE`):

```sql
     WHERE issues.status_id <> 42
       AND CASE WHEN '${situacao}' = ''
                THEN TRUE
                WHEN '${situacao}' = 'a' -- Arquivados
                THEN issues.status_id = 41
           END
```

CTEs encadeadas:

```sql
WITH primeira_cte AS (
    SELECT a.id,
           a.valor::NUMERIC
      FROM tabela_a a

), segunda_cte AS (
    SELECT b.id
      FROM tabela_b b
)
SELECT primeira_cte.id
  FROM primeira_cte
```

Subqueries em `FROM`/`JOIN` são formatadas recursivamente, com indentação
própria e seu próprio alinhamento de river (independente do escopo
externo) — o mesmo vale para o corpo de cada CTE.

`UPDATE`/`DELETE`/`INSERT` seguem o mesmo river style (`UPDATE`/`DELETE`
compartilham a máquina de cláusulas do `SELECT`, então `FROM`, `JOIN`,
`WHERE`/`AND`/`OR` etc. funcionam igual):

```sql
UPDATE ecm_conteudo
   SET nome = 'novo nome',
       ativo = TRUE
 WHERE ecm_conteudo.id = 1
   AND ecm_conteudo.categoria_id = 2
```

```sql
   DELETE
     FROM ecm_conteudo
    USING ecm_categoria
    WHERE ecm_conteudo.categoria_id = ecm_categoria.id
      AND ecm_categoria.ativo = FALSE
RETURNING ecm_conteudo.id
```

`INSERT INTO` compartilha o mesmo river com `VALUES`/`SELECT`/`RETURNING`
que vierem depois dele na mesma statement:

```sql
INSERT INTO ecm_conteudo (nome, categoria_id)
     VALUES ('a', 1),
            ('b', 2)
  RETURNING id
```

## Uso

- **Formatar documento**: `Shift+Alt+F` (formatador padrão do VSCode para
  `.sql`), ou paleta de comandos → `Competo SQL: Formatar documento`.
- **Format on save**: ative `"editor.formatOnSave": true` no VSCode para
  arquivos `.sql` (globalmente ou em `[sql]` no `settings.json`).

## Configuração

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `competoSqlFormatter.indentSize` | `4` | Espaços usados para indentar corpo de CTEs e subqueries em `FROM`/`JOIN`. |
| `competoSqlFormatter.additionalFunctions` | `[]` | Nomes de função extras (além da lista nativa padrão) a maiusculizar quando usados como chamada de função, ex. `["fn_calcula_total"]`. |

## Escopo e limitações conhecidas

- Cobre `SELECT`/`WITH` (o caso comum de queries de relatório) e o DML
  básico — `INSERT`/`UPDATE`/`DELETE`, incluindo `UPDATE ... FROM`,
  `DELETE ... USING`, `INSERT ... VALUES`/`INSERT ... SELECT` e
  `RETURNING`. Outros statements (DDL, `MERGE`, comandos de sessão...)
  ficam fora do escopo: só têm as palavras-chave maiusculizadas, sem
  reestruturação em river style.
- `INSERT ... ON CONFLICT` não é modelado especificamente — `ON CONFLICT
  (...) DO NOTHING` fica concatenado no fim da linha de `VALUES`; em
  `ON CONFLICT (...) DO UPDATE SET ...` o `SET` ganha sua própria linha
  (reaproveitando o marker normal de `SET`), mas o `ON CONFLICT (...) DO
  UPDATE` que vem antes dele fica todo na linha de `VALUES`. Não quebra a
  query, só não é formatado em cláusulas river completas.
- "Funções nativas" maiusculizadas vêm de uma lista fixa de funções do
  PostgreSQL (`src/formatter.ts`, constante `NATIVE_FUNCTIONS`); funções
  de negócio do banco só são maiusculizadas se listadas em
  `competoSqlFormatter.additionalFunctions`.
- `CASE` aninhado (um `CASE` dentro do `WHEN`/`THEN`/`ELSE` de outro) só
  quebra em blocos no `CASE` mais externo — o(s) aninhado(s) renderizam
  inline via `renderTokensInline`, igual a qualquer expressão comum.
- Identificadores entre aspas encadeados (`"tabela"."coluna"`, comum em
  SQL exportado por query builders como o do Laravel) são reconhecidos
  como um único identificador qualificado, preservando o `.` — assim como
  `tabela.coluna` sem aspas. Qualquer caractere não reconhecido por
  nenhuma regra do tokenizer (ex.: `?` de bind parameter de log de query)
  vira um token isolado em vez de ser descartado — o formatter nunca deve
  apagar conteúdo do SQL original em silêncio, mesmo que não saiba
  formatá-lo com o espaçamento ideal.
- Aspas desnecessárias em identificador são removidas: `"tabela"."coluna"`
  vira `tabela.coluna` quando o conteúdo é só minúsculas/dígito/`_` e não
  colide com uma palavra reservada do PostgreSQL. A checagem de colisão
  usa `RESERVED_KEYWORDS` (`src/tokenizer.ts`) — a lista completa de
  variantes "reserved" da [tabela oficial de keywords do
  Postgres](https://www.postgresql.org/docs/current/sql-keywords-appendix.html),
  não a `KEYWORD_SET` curada usada pra maiúsculas/marcador de cláusula
  (essa é bem menor de propósito — colocar `CREATE`/`TABLE`/`ARRAY`/etc.
  em maiúsculo sempre que aparecem bateria com DDL, fora do escopo deste
  formatter). Palavras não-reservadas do Postgres que também são nomes de
  coluna comuns (`date`, `time`, `type`, `value`, `text`, `name`...) nunca
  perdem as aspas por engano nem ficam forçadas a maiúsculo por essa
  lista, já que não são reservadas de verdade.
- Subqueries usadas dentro de uma expressão (`WHERE x IN (SELECT ...)`,
  `SELECT (SELECT ...) AS foo`) são renderizadas em uma linha só — apenas
  subqueries na posição de `FROM`/`JOIN` (derived table) recebem
  formatação multi-linha recursiva.
- Casts com nome de tipo composto por mais de uma palavra (`::double
  precision`, `::character varying`, `::timestamp with time zone`...) são
  maiusculizados por inteiro — a lista de frases reconhecidas é a
  constante `MULTI_WORD_CAST_TYPES` em `src/formatter.ts`. Um nome
  composto que não estiver nessa lista maiusculiza só a primeira palavra.

## Desenvolvimento

```bash
npm install
npm run compile   # ou: npm run watch
npm test          # suíte de snapshots em test/run.ts
npm run smoke     # imprime a formatação de vários exemplos, para inspeção manual (test/smoke.ts)
```

Para depurar dentro do VSCode: abra a raiz deste repositório como workspace
e pressione `F5` (Extension Development Host).

Para gerar um pacote instalável:

```bash
npx @vscode/vsce package
```

Isso gera um `.vsix` que pode ser instalado via
`code --install-extension competo-sql-formatter-0.1.0.vsix` ou pela aba de
Extensões do VSCode → `Install from VSIX...`.
