import pg from 'pg'

// Shared pg pool for the direct-DB (built-in / same-cluster) runner mode. The
// remote (http) mode never touches this; pg connects lazily on first query, so
// importing it in remote mode costs nothing.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://tos:tos@localhost:5432/tos',
  max: Number(process.env.PG_POOL_MAX) || 20,
})
