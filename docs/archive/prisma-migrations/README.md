# Archived Prisma migration history

These SQL files are retained only as historical evidence for databases created
before the Drizzle/Neon cutover. They are not an executable migration source.

The authoritative forward migration history is `drizzle/0000` and later. A
legacy database must first pass `npm run db:baseline:legacy`, then run the
Drizzle deployment command. The baseline verifier checks the reviewed legacy
shape before recording migration `0000`; migration `0006` conditionally
normalizes historical Prisma foreign-key names.

Do not run these archived files against a current database.
