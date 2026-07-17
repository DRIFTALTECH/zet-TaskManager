# Driftal Vault — Architecture Package

**Status:** Architecture baseline (no implementation)  
**Document:** [ARCHITECTURE.md](./ARCHITECTURE.md)  
**Date:** 2026-07-15

## Draw.io diagrams (editable in diagrams.net)

| File | Contents |
|------|----------|
| [application-architecture.drawio](./application-architecture.drawio) | Full app architecture: clients, extension, auth, layers, modules, DB |
| [erd.drawio](./erd.drawio) | Complete ERD with tables and relationships |

Open either `.drawio` file in [diagrams.net](https://app.diagrams.net/) or the Draw.io VS Code/Cursor extension.

## Stack constraints (honored)

- React + TypeScript frontend
- FastAPI backend
- Routes → Logic → CRUD → DB Wrapper → PostgreSQL
- No microservices, Redis, Kafka, RabbitMQ, Kubernetes, or Azure Key Vault
- Microsoft Entra ID only (no local auth / signup / forgot password)
