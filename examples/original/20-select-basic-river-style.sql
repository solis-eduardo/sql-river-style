-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: river style básico + uma coluna por linha + sem ; final
select tabela.coluna1, tabela.coluna2 from tabela where tabela.coluna1 = 1 and tabela.coluna2 = 2 order by tabela.coluna1
