#!/bin/bash
# ============================================================================
# OpenAidy Installer
# ============================================================================
# Installs OpenAidy on Linux, macOS, and WSL2.
#
# Usage:
#   curl -fsSL https://openaidy.dev/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --dir /path/to/install --branch feat/x
#
# ============================================================================

set -e

if [ -n "${OPENAIDY_HOME:-}" ]; then
    unset OPENAIDY_HOME
fi

export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
export PNPM_NO_CONFIG=1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
REPO_URL_SSH="git@github.com:imzodev/openaidy.git"
REPO_URL_HTTPS="https://github.com/imzodev/openaidy.git"
OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.openaidy}"
INSTALL_DIR_EXPLICIT=false
NODE_VERSION="22.12.0"

# Options
RUN_SETUP=true
SKIP_BUILD=false
BRANCH="main"
NON_INTERACTIVE=false

# Detect interactive terminal
if [ -t 0 ]; then
    IS_INTERACTIVE=true
else
    IS_INTERACTIVE=false
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-setup)
            RUN_SETUP=false
            shift
            ;;
        --branch|-Branch)
            BRANCH="$2"
            shift 2
            ;;
        --dir)
            OPENAIDY_HOME="$2"
            INSTALL_DIR_EXPLICIT=true
            shift 2
            ;;
        --non-interactive|-NonInteractive)
            NON_INTERACTIVE=true
            shift
            ;;
        --help|-Help)
            echo "Usage: curl -fsSL https://openaidy.dev/install.sh | bash [options]"
            echo ""
            echo "Options:"
            echo "  --dir <path>       Install to custom directory (default: ~/.openaidy)"
            echo "  --branch <name>    Branch to install (default: main)"
            echo "  --skip-build       Skip build step"
            echo "  --skip-setup       Skip initial setup"
            echo "  --non-interactive  Run without interactive prompts"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            shift
            ;;
    esac
done

# Resolve install dir
INSTALL_DIR="$OPENAIDY_HOME"

# OS detection
detect_os() {
    case "$(uname -s)" in
        Linux*)     OS=linux;;
        Darwin*)    OS=macos;;
        CYGWIN*|MINGW*|MSYS*) OS=windows;;
        *)          OS=unknown;;
    esac

    if [ "$OS" = "linux" ]; then
        if grep -qE "(Microsoft|WSL)" /proc/version 2>/dev/null; then
            OS=linux-wsl
        fi
        if [ -f /etc/os-release ]; then
            DISTRO=$(. /etc/os-release; echo "$ID")
        elif [ -f /etc/redhat-release ]; then
            DISTRO="fedora"
        elif [ -f /etc/debian_version ]; then
            DISTRO="debian"
        else
            DISTRO="unknown"
        fi
    elif [ "$OS" = "macos" ]; then
        DISTRO="macos"
    fi
}

log_info()    { echo -e "${BLUE}[openaidy]${NC} $*"; }
log_success() { echo -e "${GREEN}[openaidy]${NC} ✓ $*"; }
log_warn()    { echo -e "${YELLOW}[openaidy]${NC} ⚠ $*"; }
log_error()   { echo -e "${RED}[openaidy]${NC} ✗ $*"; }

prompt_yes_no() {
    local question="$1"
    local default="${2:-no}"
    if [ "$IS_INTERACTIVE" = false ]; then
        return 0
    fi
    if [ "$NON_INTERACTIVE" = true ]; then
        return 0
    fi
    local yn="[y/N]"
    if [ "$default" = "yes" ]; then
        yn="[Y/n]"
    fi
    echo -n -e "${BOLD}${question} ${yn}: ${NC}"
    read -r answer
    case "$answer" in
        [yY]|yes) return 0 ;;
        *)        return 1 ;;
    esac
}

# ============================================================================
# Git Provisioning
# ============================================================================

install_git() {
    log_info "Git not found — installing..."

    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                log_info "Installing Git via Homebrew..."
                brew install git >/dev/null 2>&1 || true
                command -v git >/dev/null 2>&1 && return 0
            fi
            if command -v xcode-select >/dev/null 2>&1; then
                log_info "Requesting Apple Command Line Tools..."
                log_info "If a dialog appears, click Install and accept the license."
                xcode-select --install >/dev/null 2>&1 || true
                local waited=0
                while [ "$waited" -lt 600 ]; do
                    if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
                        return 0
                    fi
                    sleep 5
                    waited=$((waited + 5))
                done
            fi
            return 1
            ;;
        linux)
            local sudo_cmd=""
            if [ "$(id -u 2>/dev/null || echo 1000)" -ne 0 ]; then
                command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
            fi
            case "$DISTRO" in
                ubuntu|debian)
                    log_info "Installing Git via apt..."
                    $sudo_cmd env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
                    $sudo_cmd env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null 2>&1 || true
                    ;;
                fedora)
                    log_info "Installing Git via dnf..."
                    $sudo_cmd dnf install -y git >/dev/null 2>&1 || true
                    ;;
                arch)
                    log_info "Installing Git via pacman..."
                    $sudo_cmd pacman -S --noconfirm git >/dev/null 2>&1 || true
                    ;;
            esac
            command -v git >/dev/null 2>&1 && return 0
            return 1
            ;;
    esac
    return 1
}

check_git() {
    log_info "Checking Git..."
    if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
        GIT_VERSION=$(git --version | awk '{print $3}')
        log_success "Git $GIT_VERSION found"
        return 0
    fi

    log_warn "Git not found"
    if install_git; then
        GIT_VERSION=$(git --version | awk '{print $3}')
        log_success "Git $GIT_VERSION installed"
        return 0
    fi

    log_error "Could not install Git automatically. Please install it manually."
    case "$OS" in
        linux)
            case "$DISTRO" in
                ubuntu|debian) log_info "  sudo apt update && sudo apt install git" ;;
                fedora)        log_info "  sudo dnf install git" ;;
                arch)          log_info "  sudo pacman -S git" ;;
                *)             log_info "  Use your package manager to install git" ;;
            esac
            ;;
        macos) log_info "  xcode-select --install  or  brew install git" ;;
    esac
    exit 1
}

# ============================================================================
# Node.js Provisioning
# ============================================================================

get_node_link_dir() {
    if [ "$(id -u 2>/dev/null || echo 1000)" -eq 0 ]; then
        echo "/usr/local/bin"
    else
        echo "$HOME/.local/bin"
    fi
}

install_node() {
    local arch=$(uname -m)
    local node_arch
    case "$arch" in
        x86_64)        node_arch="x64"    ;;
        aarch64|arm64) node_arch="arm64"  ;;
        armv7l)        node_arch="armv7l" ;;
        *)             node_arch="" ;;
    esac

    if [ -z "$node_arch" ]; then
        log_error "Unsupported architecture: $arch"
        log_info "Install Node.js manually from https://nodejs.org/"
        exit 1
    fi

    local node_os
    case "$OS" in
        linux|linux-wsl) node_os="linux" ;;
        macos)           node_os="darwin" ;;
        *)               node_os="" ;;
    esac

    if [ -z "$node_os" ]; then
        log_error "Unsupported OS: $OS"
        exit 1
    fi

    local download_url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${node_os}-${node_arch}.tar.xz"
    local tarball_name="$(basename "$download_url")"
    local tmp_dir=$(mktemp -d)

    log_info "Downloading Node.js $NODE_VERSION ($node_os-$node_arch)..."
    if ! curl -fsSL "$download_url" -o "$tmp_dir/$tarball_name"; then
        log_error "Download failed (URL: $download_url)"
        rm -rf "$tmp_dir"
        exit 1
    fi

    log_info "Extracting to $INSTALL_DIR/node/..."
    mkdir -p "$INSTALL_DIR"
    tar xf "$tmp_dir/$tarball_name" -C "$tmp_dir"

    local extracted_dir
    extracted_dir=$(ls -d "$tmp_dir"/node-v* 2>/dev/null | head -1)

    if [ ! -d "$extracted_dir" ]; then
        log_error "Extraction failed"
        rm -rf "$tmp_dir"
        exit 1
    fi

    rm -rf "$INSTALL_DIR/node"
    mv "$extracted_dir" "$INSTALL_DIR/node"
    rm -rf "$tmp_dir"

    local node_link_dir
    node_link_dir="$(get_node_link_dir)"
    mkdir -p "$node_link_dir"
    ln -sf "$INSTALL_DIR/node/bin/node" "$node_link_dir/node"
    ln -sf "$INSTALL_DIR/node/bin/npm"  "$node_link_dir/npm"
    ln -sf "$INSTALL_DIR/node/bin/npx"  "$node_link_dir/npx"

    export PATH="$INSTALL_DIR/node/bin:$PATH"

    local installed_ver
    installed_ver=$("$INSTALL_DIR/node/bin/node" --version 2>/dev/null)
    log_success "Node.js $installed_ver installed to $INSTALL_DIR/node/"
}

check_node() {
    log_info "Checking Node.js..."

    if command -v node >/dev/null 2>&1; then
        log_success "Node.js $(node --version) found"
        return 0
    fi

    if [ -x "$INSTALL_DIR/node/bin/node" ]; then
        export PATH="$INSTALL_DIR/node/bin:$PATH"
        log_success "Node.js $(node --version) found (OpenAidy-managed)"
        return 0
    fi

    log_info "Node.js not found — installing Node.js $NODE_VERSION LTS..."
    install_node
}

# ============================================================================
# pnpm Provisioning
# ============================================================================

install_pnpm() {
    log_info "Installing pnpm..."

    local pnpm_install_log=$(mktemp)
    local pnpm_installer=$(mktemp)

    if ! curl -fsSL https://get.pnpm.io/install.sh -o "$pnpm_installer" 2>"$pnpm_install_log"; then
        log_error "Failed to download pnpm installer"
        sed 's/^/    /' "$pnpm_install_log" >&2
        rm -f "$pnpm_install_log" "$pnpm_installer"
        exit 1
    fi

    export PNPM_HOME="$INSTALL_DIR/pnpm"
    mkdir -p "$PNPM_HOME"

    if SHELL=bash bash "$pnpm_installer" >>"$pnpm_install_log" 2>&1; then
        rm -f "$pnpm_installer" "$pnpm_install_log"
        local pnpm_ver=$("$INSTALL_DIR/pnpm/pnpm" --version 2>/dev/null)
        log_success "pnpm $pnpm_ver installed"
    else
        log_error "Failed to install pnpm"
        sed 's/^/    /' "$pnpm_install_log" >&2
        rm -f "$pnpm_install_log" "$pnpm_installer"
        exit 1
    fi
}

check_pnpm() {
    export PNPM_HOME="$INSTALL_DIR/pnpm"
    export PATH="$PNPM_HOME:$PATH"

    if command -v pnpm >/dev/null 2>&1; then
        log_success "pnpm $(pnpm --version) found"
        return 0
    fi

    if [ -x "$INSTALL_DIR/pnpm/pnpm" ]; then
        log_success "pnpm found (OpenAidy-managed)"
        return 0
    fi

    install_pnpm
}

# ============================================================================
# Repository
# ============================================================================

clone_or_update_repo() {
    log_info "Preparing repository (branch: $BRANCH)..."

    if [ -d "$INSTALL_DIR/.git" ] && git -C "$INSTALL_DIR" rev-verify --quiet HEAD 2>/dev/null; then
        log_info "Repository already exists — updating..."
        cd "$INSTALL_DIR"
        git fetch origin "$BRANCH" 2>/dev/null || true
        if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
            git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" 2>/dev/null
            git reset --hard "origin/$BRANCH" 2>/dev/null || git reset --hard
        fi
    else
        log_info "Cloning repository..."
        mkdir -p "$(dirname "$INSTALL_DIR")"

        local repo_url="$REPO_URL_HTTPS"
        if ! git ls-remote --exit-code --heads "$repo_url" HEAD >/dev/null 2>&1; then
            log_warn "HTTPS unreachable, trying SSH..."
            if git ls-remote --exit-code --heads "$REPO_URL_SSH" HEAD >/dev/null 2>&1; then
                repo_url="$REPO_URL_SSH"
                log_info "Using SSH"
            else
                log_error "Repository unreachable via HTTPS and SSH"
                log_info "Check your network connection and SSH key configuration"
                exit 1
            fi
        else
            log_info "Using HTTPS"
        fi

        rm -rf "$INSTALL_DIR"
        if ! git clone --branch "$BRANCH" --depth 1 "$repo_url" "$INSTALL_DIR" 2>&1; then
            log_error "Failed to clone repository"
            log_info "Check your network connection and try again"
            exit 1
        fi
    fi

    log_success "Repository ready at $INSTALL_DIR"
}

# ============================================================================
# Build
# ============================================================================

build_project() {
    if [ "$SKIP_BUILD" = true ]; then
        log_info "Skipping build (--skip-build)"
        return 0
    fi

    log_info "Installing dependencies..."
    cd "$INSTALL_DIR"

    export PNPM_HOME="$INSTALL_DIR/pnpm"
    export PATH="$PNPM_HOME:$PATH"

    if ! pnpm install --frozen-lockfile 2>&1; then
        log_info "Frozen lockfile failed — retrying with regular install..."
        if ! pnpm install 2>&1; then
            log_error "Dependency installation failed"
            exit 1
        fi
    fi

    log_info "Building project..."
    if ! pnpm build 2>&1; then
        log_error "Build failed"
        exit 1
    fi

    log_success "Build complete"
}

# ============================================================================
# CLI Wrapper
# ============================================================================

create_cli_wrapper() {
    local link_dir
    link_dir="$(get_node_link_dir)"
    mkdir -p "$link_dir"

    local wrapper="$link_dir/openaidy"

    cat > "$wrapper" << 'WRAPPER_EOF'
#!/bin/sh
# OpenAidy CLI wrapper — auto-managed by the installer.
# DO NOT EDIT — re-run install.sh to update.

OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.openaidy}"
export PATH="$OPENAIDY_HOME/node/bin:$OPENAIDY_HOME/pnpm:$PATH"

if [ -f "$OPENAIDY_HOME/packages/cli/bin/openaidy.ts" ]; then
    exec node --import tsx "$OPENAIDY_HOME/packages/cli/bin/openaidy.ts" "$@"
elif [ -f "$OPENAIDY_HOME/apps/server/dist/index.js" ]; then
    exec node "$OPENAIDY_HOME/apps/server/dist/index.js" "$@"
else
    echo "OpenAidy not found at $OPENAIDY_HOME" >&2
    echo "Re-run the installer: curl -fsSL https://openaidy.dev/install.sh | bash" >&2
    exit 1
fi
WRAPPER_EOF

    chmod +x "$wrapper"

    local node_link_dir
    node_link_dir="$(get_node_link_dir)"
    if [ -d "$INSTALL_DIR/node" ]; then
        ln -sf "$INSTALL_DIR/node/bin/node" "$node_link_dir/node" 2>/dev/null || true
        ln -sf "$INSTALL_DIR/node/bin/npm"  "$node_link_dir/npm"  2>/dev/null || true
    fi

    log_success "CLI installed to $wrapper"
    log_info "Run: openaidy --help"
}

# ============================================================================
# Main
# ============================================================================

main() {
    echo ""
    echo -e "${BOLD}OpenAidy Installer${NC}"
    echo ""

    detect_os
    log_info "Detected: $OS / $DISTRO"
    log_info "Install directory: $INSTALL_DIR"
    echo ""

    check_git
    check_node
    check_pnpm
    clone_or_update_repo
    build_project
    create_cli_wrapper

    echo ""
    log_success "OpenAidy is installed!"
    log_info "Get started: openaidy --help"
    echo ""
}

main