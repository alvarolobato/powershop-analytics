# PR Review Guidelines

You are reviewing a pull request for the PowerShop Analytics project.

## Project Overview
- Python ETL syncing data from 4D database to PostgreSQL (18M+ rows)
- WrenAI for ad-hoc text-to-SQL queries (40+ instructions, 52+ SQL pairs)
- Next.js + Tremor Dashboard App for AI-generated dashboards
- CLI (`ps`) for all operations

## Critical Rules
1. **Read-only SQL**: NEVER allow INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE
2. **No credentials**: No API keys, passwords, or secrets in code
3. **No customer data**: No PII or business data in committed files
4. **4D PKs are NUMERIC**: Primary keys use Real (float) with .99 suffix — store as NUMERIC, never FLOAT8
5. **No `SELECT *`**: For wide tables (Articulos 379 cols, CCStock 582 cols), always specify columns

## Review Checklist
- [ ] No security vulnerabilities (OWASP top 10)
- [ ] SQL queries are parameterized
- [ ] Error handling is appropriate (not excessive)
- [ ] Tests are included for new functionality
- [ ] No breaking changes to existing APIs
- [ ] Docker/compose changes are backward compatible
