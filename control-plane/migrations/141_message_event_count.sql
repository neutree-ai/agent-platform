ALTER TABLE public.messages
  ADD COLUMN event_count integer NOT NULL DEFAULT 0;

CREATE FUNCTION public.increment_message_event_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.messages
     SET event_count = event_count + 1
   WHERE id = NEW.message_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_events_increment_message_event_count
AFTER INSERT ON public.session_events
FOR EACH ROW EXECUTE FUNCTION public.increment_message_event_count();
