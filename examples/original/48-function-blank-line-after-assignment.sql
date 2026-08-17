-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CREATE FUNCTION: linha em branco antes de SELECT/IF aninhado quando
-- vêm logo após uma atribuição simples
create or replace function bump_score(p_id integer) returns numeric as $$
declare
v_score numeric;
begin
v_score := 10;
select amount into v_score from scores where id = p_id;
v_score := v_score + 1;
if v_score > 100 then
v_score := 100;
end if;
return v_score;
end;
$$ language plpgsql;
