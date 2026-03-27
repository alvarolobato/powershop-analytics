#!/usr/bin/env bash
# ps config — Show current configuration
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}PowerShop Analytics Configuration${NC}"
echo ""

# Show config source
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
if [ -f "${REPO_ROOT}/local/credentials.conf" ]; then
    echo -e "Config source: ${GREEN}local/credentials.conf${NC} (worktree-specific)"
elif [ -f "${HOME}/.config/powershop-analytics/credentials.conf" ]; then
    echo -e "Config source: ${GREEN}~/.config/powershop-analytics/credentials.conf${NC} (centralized)"
else
    echo -e "Config source: ${YELLOW}Not found${NC}"
    echo "  Create ~/.config/powershop-analytics/credentials.conf"
    echo "  See credentials.conf.template for format"
    exit 1
fi

echo ""
echo -e "${CYAN}4D SQL Server:${NC}"
echo "  Host: ${P4D_HOST:-<not set>}"
echo "  Port: ${P4D_PORT:-<not set>}"
echo "  User: ${P4D_USER:-<not set>}"
if [ -n "${P4D_PASSWORD}" ]; then
    echo "  Password: ****"
else
    echo "  Password: (empty)"
fi

echo ""
echo -e "${CYAN}4D SOAP Server:${NC}"
echo "  URL:  ${SOAP_URL:-<not set>}"
echo "  WSDL: ${SOAP_WSDL:-<not set>}"
echo "  User: ${SOAP_USER:-<not set>}"

echo ""
echo -e "${CYAN}Elasticsearch:${NC}"
if [ -n "${ELASTICSEARCH_URL:-}" ]; then
    echo "  URL: ${ELASTICSEARCH_URL}"
    echo "  API Key: ${ELASTICSEARCH_API_KEY:+****}"
else
    echo -e "  ${YELLOW}Not configured${NC}"
fi
