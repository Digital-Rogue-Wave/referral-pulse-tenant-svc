#!/bin/bash
# install.sh — Install Claude Code configuration for NestJS microservices
# Usage: bash install.sh [--project /path/to/project] [--user]
#
# --project: Install project-level config (CLAUDE.md, .claude/, .mcp.json, scripts/)
# --user:    Install user-level config (~/.claude/CLAUDE.md, ~/.claude/agents/)
# No flags:  Interactive mode

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

PROJECT_DIR=""
INSTALL_USER=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT_DIR="$2"; shift 2 ;;
    --user) INSTALL_USER=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Interactive mode
if [[ -z "$PROJECT_DIR" ]] && [[ "$INSTALL_USER" == false ]]; then
  echo "Claude Code NestJS Configuration Installer"
  echo "==========================================="
  echo ""
  echo "1) Install project-level config (current directory)"
  echo "2) Install user-level config (~/.claude/)"
  echo "3) Install both"
  echo ""
  read -p "Choose [1/2/3]: " choice
  case $choice in
    1) PROJECT_DIR="$(pwd)" ;;
    2) INSTALL_USER=true ;;
    3) PROJECT_DIR="$(pwd)"; INSTALL_USER=true ;;
    *) echo "Invalid choice"; exit 1 ;;
  esac
fi

# Install user-level config
if [[ "$INSTALL_USER" == true ]]; then
  echo ""
  log_info "Installing user-level configuration..."

  mkdir -p ~/.claude/agents

  # User CLAUDE.md
  if [[ -f ~/.claude/CLAUDE.md ]]; then
    log_warn "~/.claude/CLAUDE.md exists. Backing up to ~/.claude/CLAUDE.md.bak"
    cp ~/.claude/CLAUDE.md ~/.claude/CLAUDE.md.bak
  fi
  cp "$SCRIPT_DIR/user-CLAUDE.md" ~/.claude/CLAUDE.md
  log_info "Installed ~/.claude/CLAUDE.md"

  # User-level agents (available in all projects)
  for agent in "$SCRIPT_DIR"/.claude/agents/*.md; do
    cp "$agent" ~/.claude/agents/
    log_info "Installed agent: ~/.claude/agents/$(basename "$agent")"
  done

  log_info "User-level installation complete."
fi

# Install project-level config
if [[ -n "$PROJECT_DIR" ]]; then
  echo ""
  log_info "Installing project-level configuration to: $PROJECT_DIR"

  # Create directories
  mkdir -p "$PROJECT_DIR/.claude/rules"
  mkdir -p "$PROJECT_DIR/.claude/skills"
  mkdir -p "$PROJECT_DIR/.claude/hooks"

  # CLAUDE.md
  if [[ -f "$PROJECT_DIR/CLAUDE.md" ]]; then
    log_warn "CLAUDE.md exists. Backing up to CLAUDE.md.bak"
    cp "$PROJECT_DIR/CLAUDE.md" "$PROJECT_DIR/CLAUDE.md.bak"
  fi
  cp "$SCRIPT_DIR/CLAUDE.md" "$PROJECT_DIR/CLAUDE.md"
  log_info "Installed CLAUDE.md"

  # Settings
  if [[ -f "$PROJECT_DIR/.claude/settings.json" ]]; then
    log_warn ".claude/settings.json exists. Backing up."
    cp "$PROJECT_DIR/.claude/settings.json" "$PROJECT_DIR/.claude/settings.json.bak"
  fi
  cp "$SCRIPT_DIR/.claude/settings.json" "$PROJECT_DIR/.claude/settings.json"
  log_info "Installed .claude/settings.json (hooks + permissions)"

  # Rules
  cp -r "$SCRIPT_DIR/.claude/rules/"*.md "$PROJECT_DIR/.claude/rules/"
  log_info "Installed rules: $(ls "$SCRIPT_DIR/.claude/rules/"*.md | wc -l) files"

  # Skills
  cp -r "$SCRIPT_DIR/.claude/skills/"* "$PROJECT_DIR/.claude/skills/"
  log_info "Installed skills: $(ls -d "$SCRIPT_DIR/.claude/skills/"*/ | wc -l) skills"

  # Hook scripts
  cp "$SCRIPT_DIR/.claude/hooks/"*.js "$PROJECT_DIR/.claude/hooks/"
  chmod +x "$PROJECT_DIR/.claude/hooks/"*.js
  log_info "Installed hook scripts"

  # MCP config
  if [[ -f "$PROJECT_DIR/.mcp.json" ]]; then
    log_warn ".mcp.json exists. Skipping. Merge manually from $SCRIPT_DIR/.mcp.json"
  else
    cp "$SCRIPT_DIR/.mcp.json" "$PROJECT_DIR/.mcp.json"
    log_info "Installed .mcp.json (edit DATABASE_URL and tokens)"
  fi

  # Gitignore additions
  GITIGNORE_ENTRIES=(
    ".claude/agent-memory/"
    ".claude/agent-memory-local/"
    ".claude/settings.local.json"
  )
  if [[ -f "$PROJECT_DIR/.gitignore" ]]; then
    for entry in "${GITIGNORE_ENTRIES[@]}"; do
      if ! grep -qF "$entry" "$PROJECT_DIR/.gitignore"; then
        echo "$entry" >> "$PROJECT_DIR/.gitignore"
        log_info "Added to .gitignore: $entry"
      fi
    done
  fi

  echo ""
  log_info "Project-level installation complete."
  echo ""
  echo "Next steps:"
  echo "  1. Edit .mcp.json — set DATABASE_URL and GITHUB_TOKEN"
  echo "  2. Review CLAUDE.md — adjust project structure and commands"
  echo "  3. Review .claude/settings.json — adjust permissions for your workflow"
  echo "  4. Start Claude Code and test: /agents to see all sub-agents"
fi

# Companion tools installation prompt
echo ""
echo "============================================================"
echo "Companion tools (recommended)"
echo "============================================================"
echo ""
echo "This configuration is designed to work with 5 open-source tools:"
echo "  1. Context7      — live library documentation"
echo "  2. Memory Keeper — persistent memory across sessions"
echo "  3. Superpowers   — structured brainstorm → plan workflow (plugin)"
echo "  4. Claude Squad  — parallel session manager"
echo "  5. Worktrees     — built-in, no install needed"
echo ""
read -p "Install Context7 + Memory Keeper MCP servers now? [y/N]: " install_mcps

if [[ "$install_mcps" =~ ^[Yy]$ ]]; then
  if ! command -v claude &> /dev/null; then
    log_error "Claude Code CLI not found. Install it first: https://claude.com/download"
  else
    log_info "Installing Context7..."
    claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp && \
      log_info "Context7 installed" || log_warn "Context7 install failed"

    log_info "Installing Memory Keeper..."
    claude mcp add --scope user memory-keeper -- npx -y mcp-memory-keeper && \
      log_info "Memory Keeper installed" || log_warn "Memory Keeper install failed"
  fi
fi

echo ""
read -p "Install Claude Squad (requires Homebrew or curl)? [y/N]: " install_squad

if [[ "$install_squad" =~ ^[Yy]$ ]]; then
  if command -v brew &> /dev/null; then
    log_info "Installing via Homebrew..."
    brew install claude-squad && \
      (ln -sf "$(brew --prefix)/bin/claude-squad" "$(brew --prefix)/bin/cs" 2>/dev/null || true) && \
      log_info "Claude Squad installed (command: cs)"
  elif command -v curl &> /dev/null; then
    log_info "Installing via curl script..."
    curl -fsSL https://raw.githubusercontent.com/smtg-ai/claude-squad/main/install.sh | bash && \
      log_info "Claude Squad installed"
  else
    log_warn "Neither brew nor curl found. Install manually from https://github.com/smtg-ai/claude-squad"
  fi
fi

echo ""
log_info "Setup complete!"
echo ""
echo "Final step: Install Superpowers plugin INSIDE Claude Code:"
echo "  /plugin install superpowers@claude-plugins-official"
echo ""
