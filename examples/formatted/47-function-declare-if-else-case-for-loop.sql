-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CREATE FUNCTION: DECLARE/BEGIN/IF-ELSE/CASE em atribuição/FOR...LOOP
-- com UPDATE/RETURN, corpo $$...$$
CREATE OR REPLACE FUNCTION calculate_discount(p_customer_id INTEGER, p_amount NUMERIC)
RETURNS NUMERIC
AS $$
DECLARE
    v_tier TEXT;
    v_discount NUMERIC;
BEGIN
    -- busca o tier do cliente
    SELECT tier INTO v_tier
      FROM customers
     WHERE id = p_customer_id;

    IF ( v_tier = 'gold' )
    THEN
        v_discount := 0.20;
    ELSE
        v_discount := CASE WHEN p_amount > 1000
                           THEN 0.10
                           ELSE 0.05
                      END;
    END IF;

    FOR v_order_id IN (
        SELECT id
          FROM orders
         WHERE customer_id = p_customer_id
      ORDER BY id
    )
    LOOP
        UPDATE orders
           SET discount = v_discount
         WHERE id = v_order_id;
    END LOOP;

    RETURN p_amount * (1 - v_discount);
END;
$$
LANGUAGE plpgsql;
