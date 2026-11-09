# Row installation plans

## Tube installation · North and Mid

Open **Work → Tubes → Row**. The source-bound catalogue covers North and Mid; South is excluded from tube work and remains available to the existing features. Source revision, page and hash are held in the authenticated workspace's `tubeInstallation` catalogue, with the same existing membership permissions as row plans. Production assignments and templates are not shipped in public JS or test fixtures.

**Layout** shows each tube once, in north-to-south order, with its length colour and full part number. Metal means unpainted galvanised tube; lengths distinguish 8.0 / 8.3 / 8.6 m variants. A generic 20764-series coupler is shown between every adjacent pair; no joint clearance or exact coupler kit is inferred. GCS stays inside its own tube. Bearings are marked as fixed (#6, with set screws, 21022-300) or floating (#4, no set screws, 21023-300). Bearing N1/S1 is nearest GCS on the corresponding side; subsequent numbers increase outward. These are not pile IDs. Types and placement come from the row-type build-up; no universal three-fixed-per-side rule is applied, and no unavailable per-row fixed-bearing pile IDs are invented.

**End distances** shows only northernmost bearing to north end of the first tube and southernmost bearing to south end of the last tube. Source dimensions use integer millimetres; the south dimension subtracts the last bearing's local north offset from that same tube's length. GCS is never selected as a bearing. Row arrows preserve the chosen tube view and stop at missing rows or field boundaries. Intermediate bearing positions are schematic and have no numeric distance labels. Torque, torque placeholders, clamp sequences and completion records are outside this feature.

The mechanical catalogue is read-only shared workspace data. Its installation updates only `data.tubeInstallation` with a guarded version increment, preserving all other data and existing RLS. Matching requires source field, tracker number, full type (including N/S) and panel count. Conflicting manual changes display an unavailable/conflict message. Viewing works for editor, viewer and offline viewer accounts without RPC writes. Shell build `tubes-20261109-v4` precaches only rendering code. An explicit park download whitelists and saves the catalogue alongside row data. Older saved packages remain schema-compatible; re-download the park to add tube instructions. No extra network request is needed when opening an already loaded tube schedule.

Implementation verification: `node --test tests/*.test.cjs`. The source-data generator used for this release is retained in the task workspace as `work/build-tube-installation-data.py`, together with extracted source text and reconciliation records.

## Existing panel, damper and pallet plans

Open **Settings → Row installation plans**, or **Today → Team → Row installation plans** for row-based work. A plan is shared by field and row; editing it never records completed work.

All group and post numbers start at the north end and proceed south. Panel ordinals and post ordinals are independent. Panel type identity is **Description + Current Class**; colour is a visual marker. Seven slots are supported; unfinished slots wait for their real markings and colour.

The constructor stores ordered panel groups, per-group type and positive connector direction, individual damper posts and East/West sides, slope and lower bearing side. Motor positions are optional and must be entered from a confirmed source. Existing manual pallet records remain available for editing and import.

Each row has an **Automatic pallet placement** section and constructor preview. The selected row is on the left; choose the row on the right in the same field. A known next row number is offered initially, and the operator can select the actual neighbour. The forklift layout uses ceil((left panel count + right panel count) / 36) pallets; every pair is calculated independently and carryover is not tracked. For example, 100 + 100 produces six pallets, 75 + 75 produces five. When both motor positions are confirmed, the rows align at their motors and retain proportional panel lengths. A row with 75 panels and its motor after panel 21 starts 25 panels farther south than a row with 100 panels and its motor after panel 46. If either motor position is missing, the diagram shows the north ends together and states that the offset is unconfirmed.

Pallets are placed at schematic midpoints along the workload of the shifted rows from north to south. Only rows present at a placement contribute to that position. Group direction and type use each destination row's own panel ordinal. When a shared pallet lies beside different ordinals, the caption lists panel numbers in left / right order; numbering always starts at each row's north end.

Driver view displays consecutive pairs in the same field, with fixed Previous / Next arrows instead of a right-row selector. Both rows move by two on each step: 813 / 814 → 815 / 816. Entry resets an arbitrary manual neighbour to the next numbered row. The arrows stop at missing pairs or field boundaries; they do not skip missing rows or wrap. Back opens the current pair in the normal Pallets section, whose manual neighbour selector remains available. Driver navigation is local viewing state and never records placements or completed work.

Each pallet shows its positive direction and type colour. Its label sits on the left when facing the positive connector: north means left on screen, south means right. If corresponding row sections differ in direction or type, pallets identify the destination row and alternate between available rows; this is placement guidance, not a per-type stock allocation. Unknown directions show an unknown label instead of guessing. Counts must be known for both rows. Live constructor changes refresh the preview; viewing or changing the pair never saves calculated placements or records completed work. The row card links directly to **Diagram → Pallets**. Existing manual positions remain stored separately and do not override automatic placement.

`verified` means both required sections are supplied. `partial` means another section is awaiting information. `needs_review` retains uncertain markings or connector directions. Unknown counts use `null`, rather than zero. Explicit zero means no panels or dampers are required.

Imports accept an array of full plans or an object containing `plans`. Preview validates the entire input and captures existing revisions before Apply. Saving rejects a stale revision; Load latest record replaces the draft only after confirmation. Previous saved plans remain in `rowPlanHistory`.

The default team leader is assigned by the server to every open/new team and all work types. The leader has separate responsibility metadata and is counted once in staffing. Closed teams preserve their recorded leader; legacy history is not rewritten.

Apply `supabase/row-plans-upgrade.sql` before publishing these assets. It keeps invitation-based RLS and legacy work/assignment behavior. The schema update does not contain operational row data or employee identifiers. Configure the seven type slots, import authorized plans, then select the default leader using `solar_plan_change`. An administrative backup of the shared document is recommended before an initial import.

Validation:

```
node --test tests/legacy-ux.test.cjs tests/row-plans.test.cjs
```

Run `tests/row-plans-db.sql` through an administrative SQL connection to exercise the real authenticated/anonymous boundaries and server behavior; its fixtures and changes are rolled back. Legacy SQL/edge-function fixtures characterize existing behavior and are not deployment files.
