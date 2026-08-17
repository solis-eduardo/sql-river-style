-- Fonte: Sentry Answers, "How can I do an UPDATE statement with JOIN in SQL
-- Server, based on an Id match?"
-- https://sentry.io/answers/how-can-i-do-an-update-statement-with-join-in-sql-server-based-on-an-id-match/
-- Reproduz o padrão clássico da pergunta mais votada sobre o assunto no
-- Stack Overflow (stackoverflow.com/questions/2334712) — o fetch direto do
-- stackoverflow.com não foi possível neste ambiente, então a página acima
-- (que cita a mesma pergunta) foi usada como fonte. UPDATE ... FROM ... JOIN
-- também é sintaxe válida no PostgreSQL.
    UPDATE old
       SET old.name = new.name
      FROM personarchive old
      JOIN person new
        ON ( old.id = new.id )
