-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: ON sem parênteses no fonte (AND vira marker solto) é reincorporado e
-- quebrado igual
select a.id from tabela_a a inner join tabela_b b on a.x = b.x and a.y = b.y where a.ativo = true
