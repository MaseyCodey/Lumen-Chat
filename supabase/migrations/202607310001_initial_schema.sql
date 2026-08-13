create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text,
  last_name text,
  full_name text generated always as (
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
  ) stored,
  avatar_url text,
  onboarding_complete boolean not null default false,
  real_name_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_name_required_when_onboarded check (
    onboarding_complete = false
    or (
      length(trim(coalesce(first_name, ''))) > 0
      and length(trim(coalesce(last_name, ''))) > 0
      and real_name_confirmed_at is not null
    )
  )
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint group_title_required check (
    type = 'direct'
    or length(trim(coalesce(title, ''))) > 0
  )
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  file_type text,
  file_size bigint not null check (file_size >= 0 and file_size <= 1073741824),
  kind text not null check (kind in ('image', 'gif', 'video', 'file')),
  created_at timestamptz not null default now(),
  constraint attachment_path_scoped_to_conversation check (
    storage_path like conversation_id::text || '/%'
  )
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  message_type text not null default 'text' check (message_type in ('text', 'attachment', 'system')),
  attachment_id uuid references public.attachments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  constraint message_has_content check (
    deleted_at is not null
    or body is not null
    or attachment_id is not null
  )
);

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (conversation_id, profile_id)
);

create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name gin_trgm_ops);
create index if not exists profiles_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);
create index if not exists conversation_members_profile_idx
  on public.conversation_members (profile_id, conversation_id);
create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc nulls last, created_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists attachments_conversation_idx
  on public.attachments (conversation_id, created_at desc);
create index if not exists message_reads_profile_idx
  on public.message_reads (profile_id, read_at desc);
create index if not exists typing_indicators_expires_idx
  on public.typing_indicators (conversation_id, expires_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.force_google_profile_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  jwt_email text := auth.jwt() ->> 'email';
  jwt_avatar text := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'avatar_url',
    auth.jwt() -> 'user_metadata' ->> 'picture'
  );
begin
  if auth.uid() = new.id then
    new.email = coalesce(nullif(jwt_email, ''), new.email);

    if nullif(jwt_avatar, '') is not null then
      new.avatar_url = jwt_avatar;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_membership_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.conversation_id <> old.conversation_id or new.profile_id <> old.profile_id then
    raise exception 'Conversation memberships cannot be reassigned.';
  end if;

  if new.role <> old.role then
    raise exception 'Member roles cannot be changed through this client.';
  end if;

  return new;
end;
$$;

create or replace function public.touch_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set
    updated_at = now(),
    last_message_at = coalesce(new.created_at, now())
  where id = new.conversation_id;

  return new;
end;
$$;

create or replace function public.is_conversation_member(
  target_conversation_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.profile_id = target_profile_id
  );
$$;

create or replace function public.create_direct_conversation(target_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
  other_id uuid := target_profile_id;
  existing_conversation_id uuid;
  new_conversation_id uuid;
begin
  if requester is null then
    raise exception 'Authentication is required.';
  end if;

  if other_id = requester then
    raise exception 'Choose another person to start a direct message.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = other_id
      and p.onboarding_complete = true
  ) then
    raise exception 'That profile is not available.';
  end if;

  select c.id
  into existing_conversation_id
  from public.conversations c
  join public.conversation_members mine
    on mine.conversation_id = c.id
    and mine.profile_id = requester
  join public.conversation_members theirs
    on theirs.conversation_id = c.id
    and theirs.profile_id = other_id
  where c.type = 'direct'
    and (
      select count(*)
      from public.conversation_members cm
      where cm.conversation_id = c.id
    ) = 2
  limit 1;

  if existing_conversation_id is not null then
    return existing_conversation_id;
  end if;

  insert into public.conversations (type, created_by)
  values ('direct', requester)
  returning id into new_conversation_id;

  insert into public.conversation_members (conversation_id, profile_id, role)
  values
    (new_conversation_id, requester, 'member'),
    (new_conversation_id, other_id, 'member');

  return new_conversation_id;
end;
$$;

create or replace function public.create_group_conversation(
  group_title text,
  member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := auth.uid();
  clean_title text := nullif(trim(group_title), '');
  requested_member_ids uuid[];
  valid_member_ids uuid[];
  new_conversation_id uuid;
begin
  if requester is null then
    raise exception 'Authentication is required.';
  end if;

  if clean_title is null then
    raise exception 'Group name is required.';
  end if;

  select coalesce(array_agg(distinct member_id), array[]::uuid[])
  into requested_member_ids
  from unnest(coalesce(member_ids, array[]::uuid[])) as member_id
  where member_id <> requester;

  if cardinality(requested_member_ids) = 0 then
    raise exception 'Add at least one other person.';
  end if;

  select coalesce(array_agg(p.id), array[]::uuid[])
  into valid_member_ids
  from public.profiles p
  where p.id = any(requested_member_ids)
    and p.onboarding_complete = true;

  if cardinality(valid_member_ids) <> cardinality(requested_member_ids) then
    raise exception 'One or more selected profiles are unavailable.';
  end if;

  insert into public.conversations (type, title, created_by)
  values ('group', clean_title, requester)
  returning id into new_conversation_id;

  insert into public.conversation_members (conversation_id, profile_id, role)
  values (new_conversation_id, requester, 'owner');

  insert into public.conversation_members (conversation_id, profile_id, role)
  select new_conversation_id, member_id, 'member'
  from unnest(valid_member_ids) as member_id;

  return new_conversation_id;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists profiles_force_google_fields on public.profiles;
create trigger profiles_force_google_fields
before insert or update on public.profiles
for each row execute function public.force_google_profile_fields();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists conversation_members_prevent_identity_change on public.conversation_members;
create trigger conversation_members_prevent_identity_change
before update on public.conversation_members
for each row execute function public.prevent_membership_identity_change();

drop trigger if exists messages_set_updated_at on public.messages;
create trigger messages_set_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_from_message();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.attachments enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.typing_indicators enable row level security;

create policy "Profiles are searchable by signed in users"
on public.profiles
for select
to authenticated
using (onboarding_complete = true or id = auth.uid());

create policy "Users insert their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "Users update their own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Members can view their conversations"
on public.conversations
for select
to authenticated
using (public.is_conversation_member(id));

create policy "Authenticated users can create conversations for themselves"
on public.conversations
for insert
to authenticated
with check (created_by = auth.uid());

create policy "Owners and admins can update group conversations"
on public.conversations
for update
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversations.id
      and cm.profile_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversations.id
      and cm.profile_id = auth.uid()
      and cm.role in ('owner', 'admin')
  )
);

create policy "Members can view memberships in their conversations"
on public.conversation_members
for select
to authenticated
using (public.is_conversation_member(conversation_id));

create policy "Members can update their own read status"
on public.conversation_members
for update
to authenticated
using (profile_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (profile_id = auth.uid() and public.is_conversation_member(conversation_id));

create policy "Members can view messages"
on public.messages
for select
to authenticated
using (public.is_conversation_member(conversation_id));

create policy "Members can send messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
);

create policy "Senders can soft update their messages"
on public.messages
for update
to authenticated
using (sender_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

create policy "Members can view attachments"
on public.attachments
for select
to authenticated
using (public.is_conversation_member(conversation_id));

create policy "Members can create their attachments"
on public.attachments
for insert
to authenticated
with check (
  uploader_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and file_size <= 1073741824
);

create policy "Uploaders can remove attachment metadata"
on public.attachments
for delete
to authenticated
using (uploader_id = auth.uid() and public.is_conversation_member(conversation_id));

create policy "Members can view read receipts"
on public.message_reads
for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_reads.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

create policy "Members mark their own reads"
on public.message_reads
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.messages m
    where m.id = message_reads.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

create policy "Members refresh their own reads"
on public.message_reads
for update
to authenticated
using (profile_id = auth.uid())
with check (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.messages m
    where m.id = message_reads.message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

create policy "Members can view typing indicators"
on public.typing_indicators
for select
to authenticated
using (public.is_conversation_member(conversation_id));

create policy "Members can create their typing indicator"
on public.typing_indicators
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and public.is_conversation_member(conversation_id)
);

create policy "Members can update their typing indicator"
on public.typing_indicators
for update
to authenticated
using (
  profile_id = auth.uid()
  and public.is_conversation_member(conversation_id)
)
with check (
  profile_id = auth.uid()
  and public.is_conversation_member(conversation_id)
);

create policy "Members can clear their typing indicator"
on public.typing_indicators
for delete
to authenticated
using (
  profile_id = auth.uid()
  and public.is_conversation_member(conversation_id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 1073741824, null)
on conflict (id) do update
set
  public = false,
  file_size_limit = 1073741824,
  allowed_mime_types = null;

drop policy if exists "Members can read private chat files" on storage.objects;
create policy "Members can read private chat files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = (storage.foldername(name))[1]
      and cm.profile_id = auth.uid()
  )
);

drop policy if exists "Members can upload private chat files" on storage.objects;
create policy "Members can upload private chat files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = (storage.foldername(name))[1]
      and cm.profile_id = auth.uid()
  )
);

drop policy if exists "Members can delete private chat files" on storage.objects;
create policy "Members can delete private chat files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = (storage.foldername(name))[1]
      and cm.profile_id = auth.uid()
  )
);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.conversations to authenticated;
grant select, update on public.conversation_members to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select, insert, delete on public.attachments to authenticated;
grant select, insert, update, delete on public.message_reads to authenticated;
grant select, insert, update, delete on public.typing_indicators to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attachments;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.message_reads;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.typing_indicators;
exception
  when duplicate_object then null;
end $$;
