---
name: datasync-tier-tools
description: Tier-based tool selection for Datasync-style agents; Tier 2 may invoke Tier 3 tools directly when criteria match. Use when designing or implementing multi-tier tool routing, agent graphs, or delegated tool policies.
---

# Datasync: tiered tool selection

## Model

- **Tier 1**: Routing / intent — picks a coarse path (e.g. domain or workflow).
- **Tier 2**: Specialist — handles a subdomain; may call a small curated **Tier 2 toolset**.
- **Tier 3**: Low-level execution — concrete tools (API calls, DB, file ops, etc.).

## Rules

1. **Register tools per tier** in config or code: each tool has `tier` (2 or 3) and optional `parentTier2Id` linking it to the Tier 2 node that normally introduces it.

2. **Tier 2 binding (default)**  
   Tier 2 sees only its Tier 2 tools plus Tier 3 tools listed under its `allowedTier3ToolIds`. The model chooses among those after reasoning.

3. **Tier 2 → Tier 3 direct trigger**  
   When all of the following hold, **skip** an intermediate “dispatch” message and **invoke the Tier 3 tool from Tier 2** in one step:
   - User intent is unambiguous for a single Tier 3 tool (e.g. exact operation + target).
   - Required parameters are present or have safe defaults.
   - Policy allows that Tier 2 role to call that Tier 3 tool (allowlist).

4. **Implementation sketch**
   - After Tier 2 produces structured output, run a small **router predicate** (rules or classifier): if it matches exactly one Tier 3 tool and arguments validate, **execute** that tool and return its result as Tier 2’s turn output.
   - If ambiguous or missing args, Tier 2 responds with a clarification or fills from Tier 2-only tools first.

5. **Safety**
   - Every Tier 3 call from Tier 2 must pass the same authz checks as if routed through a dedicated Tier 3 node.
   - Log `tier2_direct_t3: true` for observability.

## When not to short-circuit

- Destructive or high-blast-radius operations (delete, bulk update, production deploy) unless policy explicitly allows direct Tier 2 → Tier 3.
- Multiple plausible Tier 3 tools or missing required identifiers.

## Keywords

Datasync, tiered tools, tool routing, Tier 2, Tier 3, direct tool trigger, agent delegation.
