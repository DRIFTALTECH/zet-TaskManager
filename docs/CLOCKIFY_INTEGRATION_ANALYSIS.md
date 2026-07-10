# Clockify Integration Investigation Report

This report presents a comprehensive analysis of the existing Clockify integration code, environment variables, UI components, database schemas, and outlines a minimal implementation plan to restore Clockify sync functionality with the least amount of effort and no new infrastructure.

---

## Codebase Scan Results

We searched the codebase for terms including `Clockify`, `clockify`, `CLOCKIFY`, `workspace`, `workspace_id`, `api_key`, `time entry`, and `sync`. The relevant files and findings are detailed below.

### 1. Backend Route Definitions
*   **File Path**: [routes/clockify.py](file:///c:/Driftal/zet-TaskManager/backend/routes/clockify.py)
*   **Purpose**: Exposes endpoints under `/clockify` for the frontend to check connection status, validate and save/remove credentials, and trigger incremental or full sync runs.
*   **Whether it is currently used**: The router is registered in [routes/\_\_init\_\_.py](file:///c:/Driftal/zet-TaskManager/backend/routes/__init__.py#L33) but is currently not called by the UI because the frontend component is hidden/commented out.
*   **Whether it is safe to reuse**: Yes, it provides the baseline structure, although the endpoints trigger in-memory thread pool tasks via `asyncio.create_task` running `asyncio.to_thread(_sync_worker)`.
*   **Dependencies**: `logic.clockify_logic`, `logic.auth_logic`, `routes.deps.get_current_user_id`, `crud.users`.
*   **What is missing for it to work again**: A single `POST /clockify/sync` endpoint mapping to a synchronous/direct sync action if we strictly want to avoid background threads/queues.

### 2. Backend Sync and Connection Logic
*   **File Path**: [logic/clockify_logic.py](file:///c:/Driftal/zet-TaskManager/backend/logic/clockify_logic.py)
*   **Purpose**: Implements credential validation against the Clockify API, manages configuration settings stored in the database (`app_settings` table), and defines a sync worker (`_sync_worker`) that fetches members and paginates through time entries.
*   **Whether it is currently used**: No. It is inactive because no client calls these functions.
*   **Whether it is safe to reuse**: Partially. The credential checks and HTTP fetching routines are robust and reusable. However, the sync worker is **completely stubbed regarding database persistence**; it only counts the fetched entries and updates the metadata status in `app_settings` (reconciliation was marked "out of scope for the initial migration").
*   **Dependencies**: `httpx`, `FastAPI` (HTTPException), `crud.settings`, `database.database`.
*   **What is missing for it to work again**: The actual data mapping and persistence logic to transform fetched Clockify time entries and write/upsert them into ZET's [TimesheetEntry](file:///c:/Driftal/zet-TaskManager/backend/database/models.py#L187) database table.

### 3. Frontend Pages: SettingsPage
*   **File Path**: [frontend/src/pages/SettingsPage.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/pages/SettingsPage.tsx)
*   **Purpose**: Configures various user and system settings. It contains commented-out imports and block elements for the `<ClockifyCard />`.
*   **Whether it is currently used**: Yes, the page itself is used, but the Clockify component is hidden/commented out.
*   **Whether it is safe to reuse**: Yes.
*   **Dependencies**: [frontend/src/components/settings/ClockifyCard.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/components/settings/ClockifyCard.tsx).
*   **What is missing for it to work again**: Uncommenting the import on [line 18](file:///c:/Driftal/zet-TaskManager/frontend/src/pages/SettingsPage.tsx#L18) and the block rendering code on [line 702](file:///c:/Driftal/zet-TaskManager/frontend/src/pages/SettingsPage.tsx#L702).

### 4. Frontend Component: ClockifyCard
*   **File Path**: [frontend/src/components/settings/ClockifyCard.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/components/settings/ClockifyCard.tsx)
*   **Purpose**: Renders the Clockify Sync dashboard UI card, showing connection status, connection configuration forms, last sync details, and action buttons.
*   **Whether it is currently used**: No, because it is commented out in `SettingsPage.tsx`.
*   **Whether it is safe to reuse**: Yes, it matches the premium ZET design guidelines and is fully implemented for the UI state.
*   **Dependencies**: `@tanstack/react-query`, `lucide-react`, [frontend/src/lib/analyticsApi.ts](file:///c:/Driftal/zet-TaskManager/frontend/src/lib/analyticsApi.ts).
*   **What is missing for it to work again**: Restoring its visibility on the Settings page, and optionally stripping away references to auto-sync toggles and incremental/full buttons if we only want a single "Sync Now" button calling `POST /clockify/sync`.

### 5. Frontend API Interface
*   **File Path**: [frontend/src/lib/analyticsApi.ts](file:///c:/Driftal/zet-TaskManager/frontend/src/lib/analyticsApi.ts)
*   **Purpose**: Declares frontend API client methods (`clockifyApi`) that call ZET's backend `/clockify` routes.
*   **Whether it is currently used**: No.
*   **Whether it is safe to reuse**: Yes.
*   **Dependencies**: `req` utility from `frontend/src/lib/api.ts`.
*   **What is missing for it to work again**: Nothing; the client methods are ready to use.

### 6. Client Detail Page and Analytics Notices
*   **File Path**: [frontend/src/pages/ClientDetailPage.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/pages/ClientDetailPage.tsx) and [frontend/src/components/analytics/ClientSummaryPanel.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/components/analytics/ClientSummaryPanel.tsx)
*   **Purpose**: Displays warning banners (`ClockifyNotice`) advising users that "Clockify is not connected yet. Hours and time data will appear here after the Clockify sync is enabled."
*   **Whether it is currently used**: Yes, the notices are shown when there is no connection.
*   **Whether it is safe to reuse**: Yes.
*   **Dependencies**: None.
*   **What is missing for it to work again**: A connected status on the backend, which will automatically hide these warnings once configured.

---

## Current State of Integration

The current state of the Clockify integration is **Partially Implemented**. 

*   **API & UI Foundations**: The routes, API definitions, and frontend configuration dashboard card (`ClockifyCard`) are already written and match the project's design system.
*   **Missing Database Sync**: The sync engine (`_sync_worker` in `clockify_logic.py`) has **no reconciliation/write logic**. It fetches records from the Clockify API, prints out counts to logs, and exits. It does **not** insert or update entries in the ZET database `timesheet_entries` table.
*   **Database Config Storage**: Credentials are currently configured to be saved dynamically to the `app_settings` key-value table rather than being loaded from standard environment variables (`.env`).

---

## Minimal Implementation Plan

The objective is to restore Clockify integration using the simplest synchronous flow, leveraging existing code where possible and implementing the missing transformation/database layer.

### 1. Configuration & Credentials
Instead of using dynamic database setting overrides, we will configure credentials via `.env` variables:
*   **Backend Changes**:
    *   Add two keys to [backend/.env](file:///c:/Driftal/zet-TaskManager/backend/.env):
        ```bash
        CLOCKIFY_API_KEY=your_api_key_here
        CLOCKIFY_WORKSPACE_ID=your_workspace_id_here
        ```
    *   Expose these variables globally in [backend/config.py](file:///c:/Driftal/zet-TaskManager/backend/config.py):
        ```python
        CLOCKIFY_API_KEY = os.environ.get("CLOCKIFY_API_KEY", "").strip()
        CLOCKIFY_WORKSPACE_ID = os.environ.get("CLOCKIFY_WORKSPACE_ID", "").strip()
        ```
    *   Modify `get_connection()` in [backend/logic/clockify_logic.py](file:///c:/Driftal/zet-TaskManager/backend/logic/clockify_logic.py) to read directly from these environment config variables instead of database settings:
        ```python
        from config import CLOCKIFY_API_KEY, CLOCKIFY_WORKSPACE_ID

        def get_connection(db: Db) -> dict:
            return {
                "connected": bool(CLOCKIFY_API_KEY and CLOCKIFY_WORKSPACE_ID),
                "apiKeyHint": f"{CLOCKIFY_API_KEY[:4]}{'*' * 8}" if CLOCKIFY_API_KEY else None,
                "workspaceId": CLOCKIFY_WORKSPACE_ID or None,
            }
        ```

### 2. Implement the Single Endpoint: `POST /clockify/sync`
*   **File to Modify**: [backend/routes/clockify.py](file:///c:/Driftal/zet-TaskManager/backend/routes/clockify.py)
    *   Add a direct endpoint:
        ```python
        @router.post("/sync")
        def sync_now(
            _=Depends(_require_manager_or_admin),
            db: Db = Depends(get_db),
        ):
            """Fetch and immediately reconcile Clockify time entries."""
            return clockify_logic.run_reconciliation_sync(db)
        ```

### 3. Fetch, Transform, and Persist Logic
*   **File to Modify**: [backend/logic/clockify_logic.py](file:///c:/Driftal/zet-TaskManager/backend/logic/clockify_logic.py)
    *   Implement `run_reconciliation_sync(db: Db)` to run synchronously (no background workers or thread pooling required) for the last 7 days.
    *   **Fetch**: Use the existing `httpx` logic to retrieve workspace members and download their time entries:
        ```python
        # Get members to find user IDs
        members_resp = httpx.get(
            f"{_CLOCKIFY_BASE}/workspaces/{CLOCKIFY_WORKSPACE_ID}/members",
            headers={"X-Api-Key": CLOCKIFY_API_KEY},
            timeout=15
        )
        ```
    *   **Transform & Match Users**: Match Clockify users to ZET users using their email address.
    *   **Transform & Reconcile Database**: For each fetched time entry:
        1.  Determine target user: `user = db.query(User).filter(User.email == clockify_user_email).first()`. Skip if user is not in ZET.
        2.  Map to target project and section (or fall back to a default project/section if not mapped).
        3.  Map Clockify fields to [TimesheetEntry](file:///c:/Driftal/zet-TaskManager/backend/database/models.py#L187):
            *   `id`: Generate UUID or map Clockify Entry ID to ZET Entry ID.
            *   `user_id`: ZET User ID.
            *   `work_date`: From Clockify start date (`YYYY-MM-DD`).
            *   `project_id`: Derived ZET project ID.
            *   `section_id`: Derived ZET section ID.
            *   `description`: Clockify time entry description.
            *   `time_from`: Clockify start timestamp (ISO format).
            *   `time_to`: Clockify end timestamp (ISO format).
            *   `seconds`: Total duration in seconds.
            *   `billable`: Map Clockify billable status.
            *   `created_at`: Current timestamp.
        4.  **Store/Update**: Perform an upsert (insert new record or update details if the entry already exists) to avoid duplicate entries.
    *   **Update Sync Timestamp**: Save the `lastSuccessfulSyncAt` state in the `AppSetting` table under key `clockify.sync_status`.

### 4. Enable Settings UI Section
*   **Files to Modify**:
    *   [frontend/src/pages/SettingsPage.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/pages/SettingsPage.tsx):
        *   Uncomment `import { ClockifyCard } from '@/components/settings/ClockifyCard';`
        *   Uncomment `{isManager && <ClockifyCard />}` in the render body.
    *   [frontend/src/components/settings/ClockifyCard.tsx](file:///c:/Driftal/zet-TaskManager/frontend/src/components/settings/ClockifyCard.tsx):
        *   Keep the Connection Status and Last Sync details display.
        *   Remove the "Connect form" inputs if the keys are environment-configured (displaying "Configure in .env" if missing).
        *   Wire the "Sync Now" button to call the frontend `clockifyApi.syncNow()` mapped to the single endpoint `POST /clockify/sync`.
        *   Hide the unused "Auto Sync" toggle and "Historical Import" buttons.
