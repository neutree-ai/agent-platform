-- Keep inserts out until commit: an insert after the aggregate snapshot could
-- otherwise increment event_count and then be overwritten by this UPDATE.
LOCK TABLE public.session_events IN SHARE MODE;

UPDATE public.messages m
   SET event_count = ec.cnt
  FROM (SELECT message_id, count(*)::integer AS cnt
          FROM public.session_events
         GROUP BY message_id) ec
 WHERE m.id = ec.message_id
   AND m.event_count IS DISTINCT FROM ec.cnt;
