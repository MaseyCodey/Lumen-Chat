alter table public.attachments
add column if not exists expires_at timestamptz;

update public.attachments
set expires_at = created_at + interval '7 days'
where expires_at is null;

alter table public.attachments
alter column expires_at set default (now() + interval '7 days');

alter table public.attachments
alter column expires_at set not null;

create index if not exists attachments_expires_idx
  on public.attachments (expires_at asc);

create or replace function public.finalize_expired_attachments(
  expired_attachment_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  if expired_attachment_ids is null or cardinality(expired_attachment_ids) = 0 then
    return 0;
  end if;

  update public.messages
  set
    body = coalesce(nullif(body, ''), 'Attachment expired after 7 days.'),
    attachment_id = null,
    message_type = case
      when message_type = 'attachment' then 'text'
      else message_type
    end,
    updated_at = now()
  where attachment_id = any(expired_attachment_ids);

  delete from public.attachments
  where id = any(expired_attachment_ids);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.finalize_expired_attachments(uuid[]) to service_role;
