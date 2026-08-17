-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: DECLARE: tipo de dado sai maiúsculo (incl. RETURNS); cursor
-- statements e níveis de RAISE também; FORMAT/QUOTE_IDENT são funções nativas
create function f(p_id int) returns record as $$
declare
v_a integer;
v_b record;
v_c refcursor;
v_d numeric := 0;
v_e text not null default 'x';
begin
open v_c for select 1;
fetch v_c into v_a;
close v_c;
raise debug 'd';
raise warning 'w';
raise exception 'e';
perform quote_ident('x');
return v_b;
end;
$$ language plpgsql;
