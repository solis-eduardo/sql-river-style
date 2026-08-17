-- Fonte: Neon (sucessor do postgresqltutorial.com), "PostgreSQL CREATE FUNCTION"
-- https://neon.com/postgresql/postgresql-plpgsql/postgresql-create-function
-- Função simples com DECLARE/SELECT INTO/RETURN; mantida em minúsculas como
-- publicada, pra testar a maiusculização de keywords feita pelo formatter.
create function get_film_count(len_from int, len_to int)
returns int
language plpgsql
as
$$
declare
   film_count integer;
begin
   select count(*)
   into film_count
   from film
   where length between len_from and len_to;

   return film_count;
end;
$$;
