# Clockify Importer for ZET

A standalone, independent Python project to synchronize Clockify timesheets, projects, users, and tasks directly into the ZET Aurora database using the ZET `db_wrapper`.

## Features

- Feeds Clockify time entries, projects, users, and tasks into the shared ZET database.
- Runs completely outside of the ZET API container / backend service.
- Provides a summary printed to the console.
- Supports incremental sync.

## Installation

Install the dependencies:

```bash
pip install -r requirements.txt
```

Ensure the ZET `backend` package directory is present in the repository root so it can be dynamically imported to access model schemas and custom DB query functions.

## Configuration

Copy `.env.example` to `.env` and fill in your Clockify credentials:

```ini
CLOCKIFY_API_KEY=your_clockify_api_key
CLOCKIFY_WORKSPACE_ID=your_clockify_workspace_id
CLOCKIFY_BASE_URL=https://api.clockify.me/api/v1
```

## Running the Importer

To sync the last year (365 days) of data:

```bash
python main.py
```

To sync a specific number of historical days:

```bash
python main.py --days 30
```
