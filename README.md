# powershop-analytics

Extract data from PowerShop ERP (4D database) for search and analytics.

## Quick Start

```bash
# Set up Python environment
python3 -m venv .venv
.venv/bin/pip install p4d

# Configure credentials
cp credentials.conf.template ~/.config/powershop-analytics/credentials.conf
# Edit with your values

# Test connection
cli/ps.sh sql tables
cli/ps.sh config
```

## CLI

```bash
ps sql tables              # List all tables
ps sql describe <table>    # Show columns for a table
ps sql query "<SQL>"       # Run a read-only SQL query
ps sql sample <table> [n]  # Show sample rows
ps sql count <table>       # Row count
ps config                  # Show configuration
```

## Analytics con WrenAI

WrenAI es una herramienta de GenBI (text-to-SQL) auto-hospedada que permite hacer preguntas en lenguaje natural sobre los datos de PowerShop. El stack completo corre en Docker: PostgreSQL como mirror de los datos 4D, un ETL Python que sincroniza nightly, y WrenAI con su interfaz web.

### Prerrequisitos

- Docker y Docker Compose v2
- Credenciales de acceso al servidor 4D (ver `credentials.conf.template`)
- API key de OpenRouter ([https://openrouter.ai](https://openrouter.ai))

### Inicio rápido

```bash
# 1. Copiar y configurar variables de entorno
cp .env.example .env
# Editar .env: rellenar P4D_HOST, P4D_PASSWORD, OPENROUTER_API_KEY, POSTGRES_PASSWORD

# 2. Levantar el stack
docker compose up -d

# 3. Ejecutar la carga inicial de datos (puede tardar 30-60 min)
docker compose exec etl python -m etl.main --once

# 4. Abrir WrenAI
open http://localhost:3000
```

### Configuración de OpenRouter

- Base URL: `https://openrouter.ai/api/v1` (ya configurado en `docker-compose.yml`)
- Modelo recomendado: `anthropic/claude-sonnet-4-20250514` (configurable via `WREN_LLM_MODEL` en `.env`)
- Cambiar modelo: editar `WREN_LLM_MODEL` en `.env` y reiniciar:

```bash
docker compose restart wren-ai-service
```

### Verificar la carga de datos

```bash
# Ver estado de los watermarks (última sincronización por tabla)
docker compose exec postgres psql -U postgres -d powershop -c \
  "SELECT table_name, rows_synced, status, updated_at FROM etl_watermarks ORDER BY updated_at DESC"

# Contar filas por tabla
docker compose exec postgres psql -U postgres -d powershop -c \
  "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables WHERE tablename LIKE 'ps_%' ORDER BY n_live_tup DESC"
```

### Sync nocturno

El ETL se ejecuta automáticamente cada noche a las 2:00 (configurable via `ETL_CRON_HOUR` en `.env`).

Para ejecutar manualmente:

```bash
docker compose exec etl python -m etl.main --once
```

### Diagnóstico de problemas comunes

| Problema | Causa | Solución |
|----------|-------|----------|
| ETL falla con "connection refused" a 4D | Servidor 4D no accesible | Verificar `P4D_HOST`, red, puertos 19812/8080 |
| PostgreSQL no arranca | Puerto 5432 ocupado | `docker compose down && docker compose up -d` o cambiar el puerto |
| WrenAI UI no carga | Servicios no arrancados en orden | `docker compose restart` y esperar 30s |
| "Invalid API key" en WrenAI | API key de OpenRouter incorrecta | Verificar `OPENROUTER_API_KEY` en `.env` |

### Arquitectura

```
4D Server (ERP)  →  ETL Python (nightly)  →  PostgreSQL  →  WrenAI (text-to-SQL)
  SQL :19812                                   :5432          UI :3000
  SOAP :8080
```

## Documentation

- [AGENTS.md](AGENTS.md) -- AI development guide
- [docs/architecture/](docs/architecture/) -- Data architecture diagrams (Mermaid ER)
- [docs/skills/](docs/skills/) -- Domain-specific guides (SQL dialect, data access, CLI, report generation)
- [credentials.conf.template](credentials.conf.template) -- Credential format

**Note**: Schema discovery, sample data, and generated reports contain real business data and are git-ignored. Run `ps sql schema` to generate locally.
