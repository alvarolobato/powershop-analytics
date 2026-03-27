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

## Documentation

- [AGENTS.md](AGENTS.md) -- AI development guide
- [docs/architecture/](docs/architecture/) -- Data architecture diagrams (Mermaid ER)
- [docs/skills/](docs/skills/) -- Domain-specific guides (SQL dialect, data access, CLI, report generation)
- [credentials.conf.template](credentials.conf.template) -- Credential format

**Note**: Schema discovery, sample data, and generated reports contain real business data and are git-ignored. Run `ps sql schema` to generate locally.
