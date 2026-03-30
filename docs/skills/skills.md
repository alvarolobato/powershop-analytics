# Skills in this folder

This folder contains **skill documents** for AI agents working on the powershop-analytics project. Each skill is a single reference for a specific domain. **Read this file to see what skills exist and when to use them.**

## Component Skills

| Skill | Purpose | Use when |
|-------|---------|----------|
| **[data-access.md](data-access.md)** | How to connect to 4D via SQL (P4D) and SOAP (zeep). Connection patterns, query examples, gotchas. | Running SQL queries, exploring the schema, testing SOAP calls. |
| **[4d-sql-dialect.md](4d-sql-dialect.md)** | Comprehensive 4D SQL dialect reference: data types, SELECT/JOIN/WHERE syntax, all functions, system tables, gotchas vs PostgreSQL/MySQL. | Writing SQL queries, looking up function syntax, understanding type mappings, troubleshooting 4D SQL behavior. |
| **[cli.md](cli.md)** | CLI architecture: dispatcher, commands, load-env, adding new commands. | Modifying or extending the `ps` CLI. |
| **[report-generation.md](report-generation.md)** | Full cookbook for generating the BI HTML report: all 60+ SQL queries, SOAP calls, HTML structure, design specs, action item guidelines, data quality gotchas. | Regenerating `informe-coleccion.html`, creating a new snapshot, or answering "how was the report built". |

## Reference Docs (not skills, but always relevant)

| Document | Purpose | Use when |
|----------|---------|----------|
| **[../etl-sync-strategy.md](../etl-sync-strategy.md)** | Validated sync strategy for every table: delta field, PK, method, gotchas. Confirmed against production data. | Implementing or debugging ETL sync, deciding whether a table is append-only or needs upsert. |
| **[../architecture/](../architecture/)** | Per-domain ER diagrams, row counts, field notes, and ETL sync sections. | Understanding table relationships, planning queries, checking field names. |

## Meta Skills

| Skill | Purpose | Use when |
|-------|---------|----------|
| **[agent-efficiency.md](agent-efficiency.md)** | Self-learning and documentation (where to document gotchas, update cross-refs). | After fixing non-obvious bugs or discovering gotchas; when a clear doc/skill gap appears. |

## Summary

- **Data access**: Use **data-access** for connecting to 4D SQL or SOAP.
- **SQL dialect**: Use **4d-sql-dialect** for 4D SQL syntax, functions, types, and differences from standard SQL.
- **CLI**: Use **cli** for extending the command-line tool.
- **Report generation**: Use **report-generation** to reproduce the BI report or create a new snapshot.
- **ETL sync decisions**: Read **etl-sync-strategy.md** before implementing any sync — it has validated delta fields and PKs per table.
- **Self-improvement**: Use **agent-efficiency** when guidance was missing.
