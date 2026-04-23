# powershop-analytics

![Docker Image](https://img.shields.io/docker/v/alvarolobato264/powershop-etl?label=Docker%20Hub)

This is an experiment project to use AI to analyze data from an SQL source, in this case a 4D database, also to create a self developing AI factory with LLM driven development and little human interaction.

## Deploy

### Linux / macOS

```bash
curl -fsSL https://github.com/alvarolobato/powershop-analytics/releases/latest/download/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://github.com/alvarolobato/powershop-analytics/releases/latest/download/install.ps1 | iex
```

After install:

```bash
ps-analytics up          # start all 8 containers
ps-analytics status      # verify everything is running
ps-analytics etl run     # load data from 4D (first run takes 30-60 min)
ps-analytics open        # open WrenAI UI at http://localhost:3000
```

See **[docs/deployment/getting-started.md](docs/deployment/getting-started.md)** for the full guide.

## Documentation

### Deployment

- [Getting started](docs/deployment/getting-started.md) — install, first run, verify
- [WrenAI setup](docs/deployment/wren-setup.md) — data source, LLM, model selection
- [4D connection](docs/deployment/4d-connection.md) — network, credentials, SQL server setup
- [Operations](docs/deployment/operations.md) — CLI reference, monitoring, backups, updates
- [Troubleshooting](docs/deployment/troubleshooting.md) — common issues and fixes

### For contributors

- [AGENTS.md](AGENTS.md) — AI development guide
- [docs/architecture/](docs/architecture/) — Data architecture diagrams (Mermaid ER)
- [docs/skills/](docs/skills/) — Domain-specific guides (SQL dialect, data access, CLI, report generation)

## Development

Clone the repo and use the development CLI (`cli/ps`) against the 4D source directly:

```bash
git clone https://github.com/alvarolobato/powershop-analytics.git
cd powershop-analytics
python3 -m venv .venv && .venv/bin/pip install p4d

# Configure credentials (single file shared across worktrees)
cp .env.example ~/.config/powershop-analytics/.env
# Edit with your P4D_HOST, P4D_USER, P4D_PASSWORD, OPENROUTER_API_KEY

# Explore the 4D source (use cli/ps or add cli/ to PATH)
./cli/ps sql tables
./cli/ps sql describe Ventas
./cli/ps sql query "SELECT COUNT(*) FROM Ventas"

# Run tests (uses dev dependencies, not the Docker image)
.venv/bin/pip install -r etl/requirements-dev.txt
.venv/bin/pytest
```

**Note**: Schema discovery, sample data, and generated reports contain real business data and are git-ignored. Run `ps sql schema` to generate locally.
