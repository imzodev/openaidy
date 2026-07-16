#!/bin/bash
# ============================================================================
# OpenAidy Installer
# ============================================================================
# Installs OpenAidy on Linux, macOS, and WSL2 from the prebuilt npm package
# (@openaidy/app). No git clone, no source build — just Node + ripgrep, then
# `npm install -g @openaidy/app`.
#
# Usage:
#   curl -fsSL https://openaidy.com/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --version 0.2.1
#
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
# Data root (config, state, credentials, logs) AND where a managed Node is
# installed. Honors an existing OPENAIDY_HOME; matches the CLI's default so a
# later `openaidy` invocation without env finds the same home.
OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.openaidy}"
NODE_VERSION="22.23.1"
NPM_PKG="@openaidy/app"

# Options
VERSION=""            # empty = @latest; else install @openaidy/app@$VERSION
NON_INTERACTIVE=false

# State
NODE_PROVISIONED=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version|--tag)
            VERSION="${2#v}"   # tolerate a leading "v" (v0.2.1 -> 0.2.1)
            shift 2
            ;;
        --dir)
            OPENAIDY_HOME="$2"
            shift 2
            ;;
        --non-interactive|-NonInteractive)
            NON_INTERACTIVE=true
            shift
            ;;
        --help|-Help)
            echo "Usage: curl -fsSL https://openaidy.com/install.sh | bash [options]"
            echo ""
            echo "Options:"
            echo "  --dir <path>       Data/home directory (default: ~/.openaidy)"
            echo "  --version <x.y.z>  Install a specific @openaidy/app version (default: latest)"
            echo "  --non-interactive  Run without interactive prompts"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            shift
            ;;
    esac
done

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

# Logs go to stderr so they never pollute a `$(...)` capture of a function's
# stdout (e.g. run_init returns the token, load_jwt_secret returns the secret).
log_info()    { echo -e "${BLUE}[openaidy]${NC} $*" >&2; }
log_success() { echo -e "${GREEN}[openaidy]${NC} ✓ $*" >&2; }
log_warn()    { echo -e "${YELLOW}[openaidy]${NC} ⚠ $*" >&2; }
log_error()   { echo -e "${RED}[openaidy]${NC} ✗ $*" >&2; }

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
    if ! curl -fsSL --retry 3 --retry-connrefused "$download_url" -o "$tmp_dir/$tarball_name"; then
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
    NODE_PROVISIONED=true
}

# OpenAidy's SQLite layer uses Node's built-in `node:sqlite`, available without
# a flag only on Node >= 22.13 (older Node lacks it or hides it behind
# --experimental-sqlite). A too-old system Node is bypassed for a managed copy.
node_is_adequate() {
    command -v node >/dev/null 2>&1 || return 1
    local v major minor
    v="$(node --version 2>/dev/null | sed 's/^v//')"
    major="${v%%.*}"
    minor="$(echo "$v" | cut -d. -f2)"
    [ -n "$major" ] || return 1
    [ "$major" -ge 24 ] && return 0
    [ "$major" -eq 22 ] && [ "$minor" -ge 13 ] && return 0
    return 1
}

check_node() {
    log_info "Checking Node.js..."

    if node_is_adequate; then
        log_success "Node.js $(node --version) found"
        return 0
    fi

    if command -v node >/dev/null 2>&1; then
        log_warn "Node.js $(node --version) is too old (need >= 22.13 for node:sqlite) — installing a managed copy..."
    fi

    if [ -x "$INSTALL_DIR/node/bin/node" ]; then
        export PATH="$INSTALL_DIR/node/bin:$PATH"
        if node_is_adequate; then
            log_success "Node.js $(node --version) found (OpenAidy-managed)"
            return 0
        fi
    fi

    log_info "Installing Node.js $NODE_VERSION LTS..."
    install_node
    export PATH="$INSTALL_DIR/node/bin:$PATH"
}

# ============================================================================
# ripgrep Provisioning
# ============================================================================
# Required by code_search / code_glob tools (the agent's primary search/glob
# primitives). Without ripgrep those tools fail at runtime with a clear
# install hint — the server itself boots fine.
# ============================================================================

install_ripgrep() {
    log_info "Installing ripgrep..."

    case "$OS" in
        macos)
            if command -v brew >/dev/null 2>&1; then
                log_info "Installing ripgrep via Homebrew..."
                brew install ripgrep >/dev/null 2>&1 || true
                command -v rg >/dev/null 2>&1 && return 0
            fi
            log_warn "Could not install ripgrep via Homebrew"
            ;;
        linux|linux-wsl)
            local sudo_cmd=""
            if [ "$(id -u 2>/dev/null || echo 1000)" -ne 0 ]; then
                command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
            fi
            case "$DISTRO" in
                ubuntu|debian)
                    log_info "Installing ripgrep via apt..."
                    $sudo_cmd env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ripgrep >/dev/null 2>&1 || true
                    ;;
                fedora)
                    log_info "Installing ripgrep via dnf..."
                    $sudo_cmd dnf install -y ripgrep >/dev/null 2>&1 || true
                    ;;
                arch)
                    log_info "Installing ripgrep via pacman..."
                    $sudo_cmd pacman -S --noconfirm ripgrep >/dev/null 2>&1 || true
                    ;;
            esac
            command -v rg >/dev/null 2>&1 && return 0
            log_warn "Could not install ripgrep via system package manager"
            ;;
    esac

    # Last resort: download a static binary from GitHub releases and
    # drop it into $INSTALL_DIR/bin. Works on every distro without
    # needing root or a package manager.
    local arch
    case "$(uname -m)" in
        x86_64)        arch="x86_64-unknown-linux-musl" ;;
        aarch64|arm64) arch="aarch64-unknown-linux-musl" ;;
        *)             log_error "Unsupported architecture for ripgrep fallback: $(uname -m)"; return 1 ;;
    esac
    local url="https://github.com/BurntSushi/ripgrep/releases/latest/download/ripgrep-${arch}.tar.gz"
    local tmp_dir
    tmp_dir=$(mktemp -d)
    log_info "Downloading ripgrep static binary..."
    if curl -fsSL --retry 3 --retry-connrefused "$url" -o "$tmp_dir/ripgrep.tar.gz" \
        && tar xzf "$tmp_dir/ripgrep.tar.gz" -C "$tmp_dir" \
        && mkdir -p "$INSTALL_DIR/bin" \
        && mv "$tmp_dir"/ripgrep-*/rg "$INSTALL_DIR/bin/rg" \
        && chmod +x "$INSTALL_DIR/bin/rg"; then
        rm -rf "$tmp_dir"
        export PATH="$INSTALL_DIR/bin:$PATH"
        return 0
    fi
    rm -rf "$tmp_dir"
    log_error "Failed to install ripgrep"
    return 1
}

check_ripgrep() {
    log_info "Checking ripgrep..."

    # Honor OpenAidy-managed install from a previous run.
    if [ -x "$INSTALL_DIR/bin/rg" ]; then
        export PATH="$INSTALL_DIR/bin:$PATH"
    fi

    if command -v rg >/dev/null 2>&1; then
        local ver=$(rg --version 2>/dev/null | head -1 | awk '{print $2}')
        log_success "ripgrep $ver found"
        return 0
    fi

    log_warn "ripgrep not found — required by code_search / code_glob"
    install_ripgrep
    local ver=$(rg --version 2>/dev/null | head -1 | awk '{print $2}')
    log_success "ripgrep $ver installed"
}

# ============================================================================
# OpenAidy CLI (prebuilt npm package)
# ============================================================================

install_openaidy() {
    local spec="$NPM_PKG"
    [ -n "$VERSION" ] && spec="$NPM_PKG@$VERSION"
    log_info "Installing $spec from npm..."

    # Use the resolved Node's npm.
    if command -v node >/dev/null 2>&1; then :; else export PATH="$INSTALL_DIR/node/bin:$PATH"; fi

    if ! npm install -g "$spec" 2>&1; then
        log_error "Failed to install $spec"
        log_info "Check your network connection and try again"
        exit 1
    fi

    # Expose the `openaidy` bin on PATH. npm installs it into the global prefix's
    # bin dir; symlink it into the same link dir we use for node.
    local link_dir npm_prefix bin_src
    link_dir="$(get_node_link_dir)"
    mkdir -p "$link_dir"
    npm_prefix="$(npm prefix -g 2>/dev/null || echo "$INSTALL_DIR/node")"
    for bin_src in "$npm_prefix/bin/openaidy" "$INSTALL_DIR/node/bin/openaidy"; do
        if [ -x "$bin_src" ]; then
            ln -sf "$bin_src" "$link_dir/openaidy"
            break
        fi
    done

    log_success "openaidy installed ($spec)"
}

# ============================================================================
# Bootstrap Admin Token
# ============================================================================

# Generate a 32-byte hex JWT secret. Persisted at $OPENAIDY_HOME/state/install.json
# so subsequent installs reuse it (idempotency).
generate_jwt_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
    fi
}

load_jwt_secret() {
    local manifest="$OPENAIDY_HOME/state/install.json"
    if [ -f "$manifest" ]; then
        local existing
        existing=$(grep -E '"wsTokenSecret"\s*:' "$manifest" | sed -E 's/.*"wsTokenSecret"\s*:\s*"([^"]+)".*/\1/')
        if [ -n "$existing" ]; then
            log_info "Reusing JWT signing secret from $manifest — the bootstrap admin token will NOT be regenerated."
            printf '%s' "$existing"
            return 0
        fi
    fi
    mkdir -p "$OPENAIDY_HOME/state"
    local new_secret
    new_secret=$(generate_jwt_secret)
    local tmp_manifest="$OPENAIDY_HOME/state/install.json.tmp"
    cat > "$tmp_manifest" <<EOF
{
  "wsTokenSecret": "$new_secret",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    mv "$tmp_manifest" "$manifest"
    chmod 600 "$manifest"
    log_info "Generated new JWT signing secret and persisted to $manifest."
    printf '%s' "$new_secret"
}

run_init() {
    log_info "Generating bootstrap admin token..."
    local init_output
    if ! init_output=$("$link_dir_global/openaidy" init 2>&1); then
        log_error "openaidy init failed"
        echo "$init_output" >&2
        exit 1
    fi

    local token
    token=$(printf '%s\n' "$init_output" | grep '^Bootstrap admin token: ' | sed 's/^Bootstrap admin token: //' | head -1)

    if [ -z "$token" ]; then
        log_error "openaidy init succeeded but no token line was printed"
        echo "$init_output" >&2
        exit 1
    fi

    printf '%s' "$token"
}

run_start() {
    # The packaged server serves the web UI itself on one port, so plain
    # `openaidy start` needs no flags (no Vite dev server is spawned).
    log_info "Starting the server (this may take up to 30 seconds)..."
    "$link_dir_global/openaidy" start 2>&1
}

# Capture the wrapper/link path now so run_init/run_start can invoke the bin.
link_dir_global="$(get_node_link_dir)"

# ============================================================================
# Main
# ============================================================================

main() {
    echo ""
    echo -e "${BOLD}OpenAidy Installer${NC}"
    echo ""

    detect_os
    log_info "Detected: $OS / $DISTRO"
    log_info "Home directory: $INSTALL_DIR"
    echo ""

    check_node
    check_ripgrep
    install_openaidy

    # Ensure JWT secret + generate bootstrap-admin token (idempotent).
    export WS_TOKEN_SECRET
    WS_TOKEN_SECRET=$(load_jwt_secret)
    export OPENAIDY_HOME="$INSTALL_DIR"
    BOOTSTRAP_TOKEN=$(run_init)

    # Start the server and open the browser.
    echo ""
    START_URL=""
    if START_OUTPUT=$(run_start 2>&1); then
        # -oE (POSIX ERE), not -oP — BSD/macOS grep has no -P.
        START_URL=$(echo "$START_OUTPUT" | grep -oE 'http://localhost:[0-9]+' | head -1)
        log_success "Server is ready."
    else
        log_warn "Server did not start automatically."
    fi

    echo ""
    log_success "OpenAidy is installed."
    echo ""
    echo "Bootstrap admin token: $BOOTSTRAP_TOKEN"
    echo ""

    if [ -n "$START_URL" ]; then
        # Deep-link the browser straight into the login screen with the token
        # pre-filled, so the user only has to press "Connect".
        AUTH_URL="${START_URL}/?token=$(printf '%s' "$BOOTSTRAP_TOKEN" | sed 's/#/%23/g; s/&/%26/g; s/?/%3F/g')"
        echo "Server is running at: $START_URL"
        echo "Login URL (token pre-filled): $AUTH_URL"
        echo ""

        # Auto-open browser (best-effort)
        case "$(uname -s)" in
            Linux*|WSL*)
                if command -v xdg-open >/dev/null 2>&1; then
                    xdg-open "$AUTH_URL" 2>/dev/null || echo "Open $AUTH_URL in your browser."
                else
                    echo "Open $AUTH_URL in your browser."
                fi
                ;;
            Darwin*)
                open "$AUTH_URL" 2>/dev/null || echo "Open $AUTH_URL in your browser."
                ;;
            *)
                echo "Open $AUTH_URL in your browser."
                ;;
        esac
        echo ""
        echo "Use 'openaidy stop' to stop the server."
    else
        AUTH_URL="http://localhost:3001/?token=$(printf '%s' "$BOOTSTRAP_TOKEN" | sed 's/#/%23/g; s/&/%26/g; s/?/%3F/g')"
        echo "Run 'openaidy start' to bring the server online,"
        echo "then open $AUTH_URL in your browser."
        echo ""
        echo "If it still doesn't start, check the log at:"
        echo "  $OPENAIDY_HOME/logs/server.log"
    fi
    echo ""

    if [ "$(get_node_link_dir)" = "$HOME/.local/bin" ]; then
        case ":$PATH:" in
            *":$HOME/.local/bin:"*) ;;
            *) echo "Note: add ~/.local/bin to your PATH to run 'openaidy' in new shells." ;;
        esac
    fi
}

main
