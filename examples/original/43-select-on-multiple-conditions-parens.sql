-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: ON com múltiplas condições (parênteses já no fonte) quebra uma por
-- linha, alinhada sob a primeira
select a.id from tabela_a a inner join tabela_b b on ( a.x = b.x and a.y = b.y )
