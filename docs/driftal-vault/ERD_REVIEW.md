# Driftal Vault ERD v2 — MVP Validation Review

**Date:** 2026-07-15  
**Source MVP:** Engineering Vault MVP Features  
**Artifacts:** `erd_v2.drawio`, `erd_v2.png`  
**Original (untouched):** `erd_vaulr.drawio`

---

## 1. What Changed

| Change | Detail |
|--------|--------|
| New file | Created `erd_v2.drawio` — original ERD left intact |
| Layout | Top-down spine **USERS → WORKSPACES → SECRETS**; satellites branch from SECRETS |
| Visual | Dark theme, Crow’s Foot, orthogonal connectors only |
| Labels | Meaningful verbs: `owns`, `contains`, `belongs_to`, `shared_with`, `tagged_as`, `version_of`, `attached_to`, `extends`, `member_of`, `logs` |
| Declutter | Removed legend and zone labels (Organization / History / Collaboration) |
| Table content | Stub entities filled with PK/FK/key columns; SECRETS expanded to MVP-critical fields |
| Scope trim | Removed **FAVORITES** from the MVP ERD |

---

## 2. Tables Removed

### `FAVORITES` — removed from MVP ERD

| Question | Answer |
|----------|--------|
| In Engineering Vault MVP? | **No** |
| Needed for search / share / launch / audit? | **No** |
| Decision | Defer to post-MVP |

Favorites is a convenience UX feature. It does not unlock any MVP workflow. Removing it shrinks ACL surface and UI without losing required capability. Re-add as `user_id + secret_id` composite if product prioritizes it later (~half-day work).

---

## 3. Tables Kept (with MVP rationale)

| Table | MVP mapping | Notes |
|-------|-------------|-------|
| **USERS** | Admin + Entra identity | No password columns |
| **WORKSPACES** | Teams / collections + personal vault | `workspace_type`: personal \| shared |
| **WORKSPACE_MEMBERS** | Team membership + Team Admin/User | Required for “share with team” and browse-by-team |
| **SECRETS** | Core secret management | Includes category, environment, url, username, ciphertext, expiry |
| **CATEGORIES** | Explicit MVP | Browse/filter by category |
| **TAGS** / **SECRET_TAGS** | Explicit MVP | Search by tags |
| **SECRET_SHARES** | Share with users **or** teams | `grantee_user_id` **or** `grantee_workspace_id` + `permission` |
| **ATTACHMENTS** | Explicit MVP (“attachments”) | Encrypted file payload |
| **CUSTOM_FIELDS** | Explicit MVP (“custom fields”) | Extensible metadata; sensitive flag |
| **AUDIT_EVENTS** | Explicit MVP §6 | Filter by user, secret, action, date |
| **SECRET_VERSIONS** | Not named in MVP PDF | **Kept** — see below |

### Why keep `SECRET_VERSIONS` (not in MVP bullet list)

Credential platforms fail operationally without rollback after bad edits. MVP requires edit + audit of updates; immutable version snapshots are the smallest production-safe way to support that. Recommend shipping in v1 unless schedule forces a cut — if cut, still store last ciphertext on update is **not** enough for multi-step undo.

---

## 4. Tables Added (relative to prior stub ERD)

No net-new *entities* beyond filling prior stubs. Column-level additions for presentation / MVP clarity:

| Table | Columns highlighted / completed |
|-------|----------------------------------|
| **SECRETS** | `category_id`, `owner_user_id`, `environment`, `url`/`username`, `expires_at` |
| **WORKSPACE_MEMBERS** | Full PK/FK/role (was empty stub) |
| **CATEGORIES**, **TAGS**, **SECRET_TAGS** | PK/FK/name (were empty stubs) |
| **ATTACHMENTS**, **CUSTOM_FIELDS** | Minimal production columns (were empty stubs) |
| **SECRET_SHARES** | Added `grantee_workspace_id` for team-level share (MVP: “share with teams”) |

Also added relationship **SECRETS → AUDIT_EVENTS** (`logs`) so auditors can traverse secret → events, matching MVP filter “by secret”.

---

## 5. Sharing model validation

| MVP need | Design |
|----------|--------|
| Share with **user** | `SECRET_SHARES.grantee_user_id` + permission |
| Share with **team** | `SECRET_SHARES.grantee_workspace_id` **or** implicit via `WORKSPACE_MEMBERS` when secret lives in that workspace |
| Browse by team | Secrets under `WORKSPACES` + membership |
| View / Copy / Edit / Manage | `SECRET_SHARES.permission` ladder |

**Workspace Members alone is not enough** for “share one secret with one user outside the team.” Keep both membership (team baseline) and secret_shares (exceptions / cross-team grants).

**Recommendation:** Baseline ACL for members of the secret’s workspace; use `SECRET_SHARES` for user-level or cross-workspace grants. Document exactly one “effective permission” algorithm in logic (already in architecture doc).

---

## 6. Important entities still missing (recommend before build)

MVP §7 Administration calls out items not drawn on this ERD (kept off the board to avoid clutter):

| Entity | Why |
|--------|-----|
| **password_policies** | Admin “password policies” |
| **app_settings** | Admin “application settings” |
| **secret_types** (optional catalog) | Admin “secret types” — can be enum on `secrets.secret_type` for MVP instead of a table |

**Recommendation:** Implement `password_policies` and `app_settings` as real tables; keep `secret_type` as constrained text/enum for MVP (add catalog table only if admins must rename/reorder types without deploy).

Also ensure SECRETS stores (not all drawn to avoid density):

- `description`, `is_archived`, `last_used_at`, `last_used_by` (launcher MVP)
- AES-GCM `nonce` / `auth_tag` (or packed with ciphertext)

---

## 7. Recommendations before implementation

1. **Lock ACL algorithm** — document effective permission = max(global admin, workspace baseline, direct share).
2. **Ship without Favorites** — reintroduce behind a checkbox only if users file a request in pilot.
3. **Keep Custom Fields + Attachments** — both are literal MVP text, not optional.
4. **Keep SECRET_VERSIONS** for first production; if schedule slips, cut UI restore first, still write version rows.
5. **Add app_settings + password_policies** in first migration even if UI is minimal admin screens.
6. **Do not add** Redis, object storage, or Key Vault for MVP — attachments in DB with size cap remain acceptable.
7. Use `erd_v2.drawio` as the architecture review artifact; treat `erd_vaulr.drawio` as draft/historical.

---

## 8. Entity count summary

| | Count |
|--|------:|
| Prior visual entities (v1) | 13 |
| Removed | 1 (`FAVORITES`) |
| MVP ERD v2 entities | **12** |

```
USERS
 └── WORKSPACES ── WORKSPACE_MEMBERS
        └── SECRETS
              ├── CATEGORIES / TAGS / SECRET_TAGS
              ├── SECRET_SHARES
              ├── SECRET_VERSIONS
              ├── ATTACHMENTS / CUSTOM_FIELDS
              └── AUDIT_EVENTS
```
