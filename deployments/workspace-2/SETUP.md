# Workspace dashboard

This standalone copy connects only to https://kpuuoprtedbjnnbebitu.supabase.co.

Upload the contents of this folder to a separate static website deployment. Keep index.html at the root. Do not overwrite the original property deployment.

Sign in using the user created in the Workspace Supabase project. The user must be in app_admins to see Data → Import residents. Upload the complete current, future and notice reports together, preview, then confirm.

The database tables and admin setup must already be installed. No resident files, logs, private credentials or original property database settings are included in this folder. Browser storage for pins, to-dos and sticky notes is separate from the original app.

Quick-access URLs are unset; add matching resources from the Resources tab. Vendor suggestions and tracker labels are inherited defaults and can be adjusted in data.js for Workspace.

Optional Claude setup: deploy supabase/functions/quick-log-ai from the main repository to the Workspace project, and set ANTHROPIC_API_KEY as a server secret. It will not work until deployed; regular quick-log saving works without it.

Public URL folder: workspace-2. Property name and buildings are loaded from the authenticated-only property_settings table. Run the separately supplied private-property-settings.sql in this project; never upload that private SQL file to the repository.
