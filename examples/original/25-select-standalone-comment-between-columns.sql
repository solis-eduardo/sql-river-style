-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: comentário standalone entre colunas do SELECT fica entre elas, não
-- no topo
select t.id,
              -- comentário entre colunas
              t.nome
       from tabela t
