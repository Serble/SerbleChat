#!/bin/bash
# SerbleChat Stress Test Helper Script

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║         SerbleChat Stress Testing Tool                       ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        echo "Please install Node.js 20+ from https://nodejs.org/"
        exit 1
    fi
    print_success "Node.js found: $(node --version)"
}

check_npm() {
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    print_success "npm found: $(npm --version)"
}

install_deps() {
    print_info "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
}

setup() {
    print_header
    echo "Setting up SerbleChat Stress Test Tool..."
    echo ""
    
    check_node
    check_npm
    
    if [ ! -d "node_modules" ]; then
        install_deps
    else
        print_success "Dependencies already installed"
    fi
    
    if [ ! -f "config.json" ]; then
        print_info "Creating config.json from config.minimal.json"
        cp config.minimal.json config.json
        print_success "Config file created"
        echo ""
        print_info "Please edit config.json and add your auth tokens"
    else
        print_success "Config file exists"
    fi
    
    echo ""
    print_success "Setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Edit config.json and add your tokens"
    echo "  2. Run: ./stress-test.sh run"
}

run_test() {
    local config="${1:-config.json}"
    
    if [ ! -f "$config" ]; then
        print_error "Config file not found: $config"
        exit 1
    fi
    
    print_header
    print_info "Running stress test with: $config"
    echo ""
    
    node index.js "$config"
}

run_scenario() {
    local scenario="$1"
    
    if [ -z "$scenario" ]; then
        print_error "Scenario name required"
        echo ""
        echo "Available scenarios:"
        echo "  - messages    (High-volume message testing)"
        echo "  - guilds      (Guild management stress)"
        echo "  - social      (Friend and group chat testing)"
        echo ""
        echo "Usage: ./stress-test.sh scenario <name>"
        exit 1
    fi
    
    local config="config.scenario-${scenario}.json"
    
    if [ ! -f "$config" ]; then
        print_error "Scenario config not found: $config"
        print_info "Generating scenario configs..."
        node generate-scenarios.js
        echo ""
    fi
    
    run_test "$config"
}

get_token() {
    local cmd="$1"
    local value="$2"
    
    if [ -z "$cmd" ]; then
        print_error "Command required"
        echo ""
        echo "Token commands:"
        echo "  auth <code>   - Get token from auth code"
        echo "  test <token>  - Test if token is valid"
        echo "  add <token>   - Add token to config"
        echo ""
        echo "Usage: ./stress-test.sh token <command> <value>"
        exit 1
    fi
    
    node get-token.js "$cmd" "$value"
}

show_stats() {
    print_header
    
    if [ ! -f "config.json" ]; then
        print_error "No config.json found"
        exit 1
    fi
    
    echo "Current Configuration:"
    echo ""
    
    if command -v jq &> /dev/null; then
        echo "API URL: $(jq -r '.apiBaseUrl' config.json)"
        echo "Bot Count: $(jq '.tokens | length' config.json)"
        echo "Actions/Min: $(jq -r '.messagesPerMinute' config.json)"
        echo ""
        
        enabled_count=$(jq '[.enabledActions | to_entries[] | select(.value == true)] | length' config.json)
        echo "Enabled Actions: $enabled_count"
    else
        cat config.json
    fi
}

show_help() {
    print_header
    echo "Usage: ./stress-test.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  setup                    - Initial setup and dependency installation"
    echo "  run [config]            - Run stress test (default: config.json)"
    echo "  scenario <name>         - Run a pre-built scenario"
    echo "  token <cmd> <value>     - Manage authentication tokens"
    echo "  stats                   - Show current configuration"
    echo "  scenarios               - Generate scenario configs"
    echo "  help                    - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./stress-test.sh setup"
    echo "  ./stress-test.sh run"
    echo "  ./stress-test.sh run config.minimal.json"
    echo "  ./stress-test.sh scenario messages"
    echo "  ./stress-test.sh token auth ABC123"
    echo "  ./stress-test.sh token test eyJhbG..."
    echo ""
    echo "Quick Start:"
    echo "  1. ./stress-test.sh setup"
    echo "  2. Edit config.json with your tokens"
    echo "  3. ./stress-test.sh run"
    echo ""
}

# Main
case "${1:-help}" in
    setup)
        setup
        ;;
    run)
        run_test "${2:-config.json}"
        ;;
    scenario)
        run_scenario "$2"
        ;;
    token)
        get_token "$2" "$3"
        ;;
    stats)
        show_stats
        ;;
    scenarios)
        print_header
        print_info "Generating scenario configurations..."
        node generate-scenarios.js
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
