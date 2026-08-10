-- Drain watermark for the token-usage puller.
--
-- `updated_at` cannot answer "has this workspace's usage been read to the end?".
-- It advances after every batch, including the batches that ran before a pull
-- failed partway, so a cursor left halfway through a backlog still looks freshly
-- updated. A consumer that needs a complete account of a finished session — an
-- external harness reading what one run cost — has to tell "there is nothing
-- left to collect" apart from "the pull never got that far".
--
-- drained_through is written only when a pull reaches the agent's end of data,
-- and holds the wall-clock time of that pull. Anything the agent wrote to a
-- transcript more than one settle grace before it is in the ledger: the parser
-- withholds a file's trailing entry until the file has been quiescent that long,
-- so every older entry was offered and ingested.

ALTER TABLE workspace_usage_cursor
  ADD COLUMN IF NOT EXISTS drained_through timestamptz;
