-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: parâmetro posicional do PL/pgSQL ($1, $2...) não é confundido com
-- tag de dollar-quote
create function myfunc(refcursor, refcursor) returns setof refcursor as $$
begin
open $1 for select * from table_1;
return next $1;
open $2 for select * from table_2;
return next $2;
end;
$$ language plpgsql;
