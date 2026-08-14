alter table public.conversations
add column if not exists image_path text,
add column if not exists image_updated_at timestamptz;

alter table public.conversations
drop constraint if exists group_image_path_scoped;

alter table public.conversations
add constraint group_image_path_scoped check (
  image_path is null
  or image_path like id::text || '/group-image/%'
);

create or replace function public.is_app_admin(user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and lower(p.email) in (
        'hellerud.mason@gmail.com',
        'mase.hellerud@unbound.school'
      )
  );
$$;

create or replace function public.can_manage_group(
  group_conversation_id uuid,
  user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id
    where c.id = group_conversation_id
      and c.type = 'group'
      and cm.profile_id = user_id
      and (
        cm.role in ('owner', 'admin')
        or public.is_app_admin(user_id)
      )
  );
$$;

create or replace function public.add_group_members(
  group_conversation_id uuid,
  member_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if not public.can_manage_group(group_conversation_id) then
    raise exception 'Only group admins can add members.';
  end if;

  insert into public.conversation_members (conversation_id, profile_id, role)
  select group_conversation_id, requested_profile_id, 'member'
  from unnest(member_ids) requested_profile_id
  join public.profiles p
    on p.id = requested_profile_id
  where p.onboarding_complete = true
  on conflict (conversation_id, profile_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.set_group_member_role(
  group_conversation_id uuid,
  target_profile_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if new_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member.';
  end if;

  if not public.can_manage_group(group_conversation_id) then
    raise exception 'Only group admins can change roles.';
  end if;

  select role into target_role
  from public.conversation_members
  where conversation_id = group_conversation_id
    and profile_id = target_profile_id;

  if target_role is null then
    raise exception 'That person is not in this group.';
  end if;

  if target_role = 'owner' then
    raise exception 'The group owner role cannot be changed.';
  end if;

  update public.conversation_members
  set role = new_role
  where conversation_id = group_conversation_id
    and profile_id = target_profile_id;
end;
$$;

create or replace function public.update_group_image(
  group_conversation_id uuid,
  image_storage_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_group(group_conversation_id) then
    raise exception 'Only group admins can change the group picture.';
  end if;

  if image_storage_path is not null
    and image_storage_path not like group_conversation_id::text || '/group-image/%' then
    raise exception 'Group picture path is not valid.';
  end if;

  update public.conversations
  set
    image_path = image_storage_path,
    image_updated_at = case when image_storage_path is null then null else now() end,
    updated_at = now()
  where id = group_conversation_id
    and type = 'group';
end;
$$;

drop policy if exists "App admins can update group conversations" on public.conversations;
create policy "App admins can update group conversations"
on public.conversations
for update
to authenticated
using (public.can_manage_group(id))
with check (public.can_manage_group(id));

grant execute on function public.is_app_admin(uuid) to authenticated;
grant execute on function public.can_manage_group(uuid, uuid) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.update_group_image(uuid, text) to authenticated;
