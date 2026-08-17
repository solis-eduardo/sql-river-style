-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CREATE FUNCTION: comentários standalone antes do CREATE são
-- preservados (não somem mais)
-- primeira linha do cabeçalho
-- segunda linha do cabeçalho
create function f() returns int as $$
begin
return 1;
end;
$$ language plpgsql;
