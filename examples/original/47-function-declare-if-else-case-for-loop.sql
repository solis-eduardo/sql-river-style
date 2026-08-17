-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CREATE FUNCTION: DECLARE/BEGIN/IF-ELSE/CASE em atribuição/FOR...LOOP
-- com UPDATE/RETURN, corpo $$...$$
create or replace function calculate_discount(p_customer_id integer, p_amount numeric) returns numeric as $$
declare
v_tier text;
v_discount numeric;
begin
-- busca o tier do cliente
select tier into v_tier from customers where id = p_customer_id;
if (v_tier = 'gold') then
v_discount := 0.20;
else
v_discount := case when p_amount > 1000 then 0.10 else 0.05 end;
end if;
for v_order_id in (select id from orders where customer_id = p_customer_id order by id) loop
update orders set discount = v_discount where id = v_order_id;
end loop;
return p_amount * (1 - v_discount);
end;
$$ language plpgsql;
