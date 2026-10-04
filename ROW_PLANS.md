# Row installation plans

Open **Settings → Row installation plans**, or **Today → Team → Row installation plans** for row-based work. A plan is shared by field and row; editing it never records completed work.

All group and post numbers start at the north end and proceed south. Panel ordinals and post ordinals are independent. Panel type identity is **Description + Current Class**; colour is a visual marker. Seven slots are supported; unfinished slots wait for their real markings and colour.

The constructor stores ordered panel groups, per-group type and positive connector direction, individual damper posts and East/West sides, slope and lower bearing side. Motor and pallet positions are optional and must be entered from a confirmed source.

`verified` means both required sections are supplied. `partial` means another section is awaiting information. `needs_review` retains uncertain markings or connector directions. Unknown counts use `null`, rather than zero. Explicit zero means no panels or dampers are required.

Imports accept an array of full plans or an object containing `plans`. Preview validates the entire input and captures existing revisions before Apply. Saving rejects a stale revision; Load latest record replaces the draft only after confirmation. Previous saved plans remain in `rowPlanHistory`.

The default team leader is assigned by the server to every open/new team and all work types. The leader has separate responsibility metadata and is counted once in staffing. Closed teams preserve their recorded leader; legacy history is not rewritten.

Apply `supabase/row-plans-upgrade.sql` before publishing these assets. It keeps invitation-based RLS and legacy work/assignment behavior. The schema update does not contain operational row data or employee identifiers. Configure the seven type slots, import authorized plans, then select the default leader using `solar_plan_change`. An administrative backup of the shared document is recommended before an initial import.

Validation:

```
node --test tests/legacy-ux.test.cjs tests/row-plans.test.cjs
```

Run `tests/row-plans-db.sql` through an administrative SQL connection to exercise the real authenticated/anonymous boundaries and server behavior; its fixtures and changes are rolled back. Legacy SQL/edge-function fixtures characterize existing behavior and are not deployment files.
