-- Fonte: Neon (sucessor do postgresqltutorial.com), "PostgreSQL CREATE FUNCTION"
-- https://neon.com/postgresql/postgresql-plpgsql/postgresql-create-function
-- Função simples com DECLARE/SELECT INTO/RETURN; mantida em minúsculas como
-- publicada, pra testar a maiusculização de keywords feita pelo formatter.
CREATE FUNCTION get_film_count(len_from INT, len_to INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    film_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO film_count
      FROM film
     WHERE length BETWEEN len_from AND len_to;

    RETURN film_count;
END;
$$;
