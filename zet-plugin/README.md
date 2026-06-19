# ZET plugin for Claude Code

Use the **ZET task manager** straight from Claude Code (or any MCP client). This plugin gives you:

- A ready-made connection to the ZET **MCP server** — no manual wiring.
- A set of `/zet:…` **slash commands** for everyday actions (tasks, timesheets, projects, standups).
- **Role-aware tools** — managers/admins get the management tools, employees only see what they're allowed to use. Enforced on the server, so it's the same in every client.

Backend (production): **`https://zetapi.driftal.tech/`**
MCP endpoint: **`https://zetapi.driftal.tech/mcp/`** (the trailing `/` matters — see [Troubleshooting](#troubleshooting)).

---

## 1. What you get

### Slash commands

| Command | What it does | Who can use it |
|---|---|---|
| `/zet:whoami` | Show who your token belongs to + your role | everyone |
| `/zet:tasks [project]` | List your tasks (or a project's tasks) | everyone |
| `/zet:project [name]` | List projects, or one project's members + sections | everyone |
| `/zet:create-task <description>` | Create a task from plain English | project members |
| `/zet:move <task> to <status>` | Move a task on the board | task assignees |
| `/zet:log <what you did>` | Log a timesheet entry | everyone |
| `/zet:timesheet [range] [employee]` | View a timesheet | self (others → managers) |
| `/zet:standup <notes>` | Post a daily scrum | everyone |
| `/zet:assign add/remove <emp> to/from <project>` | Project membership | manager / admin |

### Underlying tools

The commands sit on top of MCP tools (`whoami`, `list_my_tasks`, `log_work`, `create_task`, …). Those tools also work directly — in Claude Code and in other MCP clients like Cursor — even without the slash commands.

---

## 2. Get your access token (PAT)

You authenticate with a **Personal Access Token**. Get one once:

1. Open the ZET web app.
2. Go to **Settings → Developer settings**.
3. Click **Generate token**.
4. Copy it somewhere safe — you'll paste it below. (Treat it like a password.)

> Prefer logging in with a browser instead of a token? See [Option B: OAuth login](#option-b-oauth-login-browser).

---

## 3. Install in Claude Code

You have two routes. **Route A (plugin)** also gives you the `/zet:` slash commands. **Route B (MCP only)** just connects the tools.

### Route A — install the plugin (recommended)

In the Claude Code chat input, run:

```
/plugin marketplace add /Users/Lokesh/Desktop/TaskManager/zet-plugin
/plugin install zet@zet-marketplace
```

Then **restart Claude Code** so it loads the server and commands.

The plugin connects the MCP server for you. To authenticate, add your token (see [step 4](#4-authenticate)).

### Route B — add the MCP server only

In your terminal:

```
claude mcp add zet --transport http https://zetapi.driftal.tech/mcp/ --header "Authorization: Bearer <YOUR_TOKEN>"
```

Replace `<YOUR_TOKEN>` with the PAT from step 2. Then **restart Claude Code**. (No slash commands with this route — tools only.)

---

## 4. Authenticate

### Option A — token (simplest, no browser)

If you used **Route B** above, you already pasted the token — you're done.

If you used **Route A (plugin)**, add the token by re-adding the server with a header:

```
claude mcp add zet --transport http https://zetapi.driftal.tech/mcp/ --header "Authorization: Bearer <YOUR_TOKEN>"
```

Restart Claude Code.

### Option B — OAuth login (browser)

Want a real login screen instead of a token?

1. Add the server **without** the header:
   ```
   claude mcp add zet --transport http https://zetapi.driftal.tech/mcp/
   ```
2. Restart Claude Code.
3. Run `/mcp` in the chat input.
4. Select **zet** → choose **Authenticate** / **Login**.
5. Your browser opens the ZET consent page → log in (email/password or Microsoft) → approve.
6. Back in Claude, **zet** shows as **connected**.

---

## 5. Verify it works

1. Run `/mcp` — **zet** should be listed as **connected**.
2. Run `/zet:whoami` — it should print your name, email and role.

If `whoami` returns your details, you're set. Try:

```
/zet:tasks
/zet:log spent 2h on API work in the Platform project today
/zet:timesheet this week
```

---

## 6. Use in Cursor (or other MCP clients)

Slash commands are Claude-Code-only, but the **ZET tools are portable**. In Cursor:

1. **Settings → MCP → Add new MCP server** (HTTP type).
2. Use this config:
   ```json
   {
     "mcpServers": {
       "zet": {
         "url": "https://zetapi.driftal.tech/mcp/",
         "headers": { "Authorization": "Bearer <YOUR_TOKEN>" }
       }
     }
   }
   ```
3. Save and reload. The model can now call every ZET tool (`list_my_tasks`, `log_work`, `create_task`, …) — with the same role-aware filtering applied server-side.

You won't get the `/zet:` shortcuts, but you can just ask in plain English ("log 3 hours on the website project today") and the model uses the tools.

---

## 7. Troubleshooting

**`/zet:whoami` says "no whoami tool found" / no ZET tools loaded**
The MCP server isn't connected in this session. Make sure you ran the install/add step **and restarted Claude Code**. Then check with `/mcp`.

**`401 Unauthorized`**
No valid token. Re-check your PAT, and that the header is exactly `Authorization: Bearer <token>` (one space, no quotes around the token). Generate a fresh token in Settings → Developer settings if unsure.

**Connection redirects / "405" / silent failure — the trailing slash**
Always use `https://zetapi.driftal.tech/mcp/` **with the trailing slash**. The server redirects `/mcp` → `/mcp/`, and some clients don't follow redirects, so they fail. Add the slash and it works.

**Tools I expected aren't showing up**
That's the role filter doing its job. Employees don't see manager-only tools (`assign_user_to_project`, `remove_user_from_project`). Log in as a manager/admin to see them.

**Check the backend is alive**
```
curl https://zetapi.driftal.tech/health
```
Should return a JSON status with `"status": "ok"`.

---

## Quick reference

```
# Connect with a token (one line, tools only)
claude mcp add zet --transport http https://zetapi.driftal.tech/mcp/ --header "Authorization: Bearer <YOUR_TOKEN>"

# Connect with slash commands (plugin)
/plugin marketplace add /Users/Lokesh/Desktop/TaskManager/zet-plugin
/plugin install zet@zet-marketplace

# Verify
/mcp
/zet:whoami
```
