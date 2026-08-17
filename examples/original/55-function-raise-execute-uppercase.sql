-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: RAISE/EXECUTE saem maiúsculos dentro do corpo, igual
-- BEGIN/RETURN/END, mesmo sem estruturação própria
create function f() returns void as $$
begin
raise notice 'oi %', 1;
execute format('select %I', 'x');
end;
$$ language plpgsql;
