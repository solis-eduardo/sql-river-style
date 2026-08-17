-- Fonte: PostgreSQL Documentation, "43.6. Control Structures" (exemplo
-- "Merge Database" — loop de tentativa UPDATE/INSERT com tratamento de
-- exceção para unique_violation)
-- https://www.postgresql.org/docs/current/plpgsql-control-structures.html (PostgreSQL License)
CREATE FUNCTION merge_db(key INT, data TEXT) RETURNS VOID AS
$$
BEGIN
    LOOP
        -- first try to update the key
        UPDATE db SET b = data WHERE a = key;
        IF found THEN
            RETURN;
        END IF;
        -- not there, so try to insert the key
        -- if someone else inserts the same key concurrently,
        -- we could get a unique-key failure
        BEGIN
            INSERT INTO db(a,b) VALUES (key, data);
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            -- Do nothing, and loop to try the UPDATE again.
        END;
    END LOOP;
END;
$$
LANGUAGE plpgsql;
