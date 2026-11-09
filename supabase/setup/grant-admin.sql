-- Run in the FRIEND'S project SQL Editor AFTER friend-property.sql.
-- First create/invite her login in Authentication > Users.
-- Copy her User UID, then replace PASTE_USER_ID_HERE below. This is NOT a password.
-- Run once for each person who should administer this property's dashboard.
do $$
declare target_user uuid := 'PASTE_USER_ID_HERE';
begin
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'That user does not exist in this project. Create her login in Authentication > Users first.';
  end if;
  insert into public.app_admins(user_id) values (target_user) on conflict (user_id) do nothing;
end;
$$;
