# Set up a separate property's dashboard

1. Open the friend's **new Supabase project**, then **SQL Editor → New query**.
2. Paste all of `friend-property.sql` and run it once. It creates the six empty dashboard tables, access policies, server-side author tracking, and the admin-only resident import function. It refuses to run if dashboard tables already exist.
3. In **Authentication → Users**, create or invite her login. Keep public sign-ups disabled: signed-in users in this project share this property's dashboard data.
4. Copy her **User UID**. Open `grant-admin.sql`, replace `PASTE_USER_ID_HERE` with that UID, and run it in the same project's SQL Editor. This enables resource management and resident uploads for her login.
5. Connect the separate app deployment to this project's URL and public API key. Set its property name and quick-access links. Do not put a service-role key or database password in the website.
6. Sign in, open **Data → Import residents**, upload the complete current/future/notice reports together, preview, and confirm. Unit/name duplicates are removed; status is not tracked.

This setup does not copy any data from the original property, deploy the website, or create Auth users. Deploy the `quick-log-ai` Edge Function and set its `ANTHROPIC_API_KEY` secret separately if Claude is wanted.

SQL and PL/pgSQL syntax were checked with PostgreSQL's parser (pglast). The scripts have not been executed against the friend's project; check the Supabase SQL Editor result before connecting the deployment.
