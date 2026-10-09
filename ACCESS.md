# Workspace access

Workspace membership is stored in public.solar_members. access_role is editor or viewer; existing members retain editor access. Provision a new confirmed password user through the server-side Auth Admin API and add a viewer membership before handing out its credentials. Credentials and account provisioning code must never be committed or bundled with the app.

Apply supabase/viewer-access-upgrade.sql after the existing workspace and row-plan migrations, before publishing this client. The solar_access RPC reports the current account's trusted role. A failed role lookup disables editing and workspace loading.

Viewer accounts can read people, teams, history, row instructions, seven panel types and automatic pallet layouts. Filters and pallet pair selection stay interactive. Editing actions, constructors, imports and submissions are hidden or rejected. The server independently denies viewer writes to solar_shared, invitations, both write RPCs and employee photo storage. Authorization comes from the membership table and confirmed Auth identity, never editable user metadata.

The shared viewer account can sign in from several devices. Its Sign out action uses the local scope, so other devices keep their sessions. Existing editor logout behavior is preserved.

Validation:
- Node regression suites in tests/legacy-ux.test.cjs and tests/row-plans.test.cjs.
- tests/viewer-access-db.sql runs real authenticated/editor/viewer/anonymous checks in a transaction and rolls every fixture back.
- Verify password sign-in in two isolated browser contexts, role lookup, RPC denial, Storage denial and session refresh after local sign-out against the deployed service.

No public sharing or anonymous workspace access is added.

