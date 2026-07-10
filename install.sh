#!/bin/bash
# ============================================================================
# OpenAidy Installer
# ============================================================================
# Installs OpenAidy on Linux, macOS, and WSL2.
#
# Usage:
#   curl -fsSL https://openaidy.com/install.sh | bash
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
# Empty = auto: resolve the latest published release tag (falling back to
# `main` when no release exists yet). An explicit --branch/--tag overrides.
BRANCH=""
BRANCH_EXPLICIT=false
NON_INTERACTIVE=false

# State
NODE_PROVISIONED=false

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
        --branch|-Branch|--tag)
            BRANCH="$2"
            BRANCH_EXPLICIT=true
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
            echo "Usage: curl -fsSL https://openaidy.com/install.sh | bash [options]"
            echo ""
            echo "Options:"
            echo "  --dir <path>       Install to custom directory (default: ~/.openaidy)"
            echo "  --branch <ref>     Branch or tag to install"
            echo "                     (default: latest release; use 'main' for the dev edge)"
            echo "  --tag <ref>        Alias for --branch (install a specific release tag)"
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
            ;;
    esac

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

check_git() {
    log_info "Checking Git..."

    if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
        GIT_VERSION=$(git --version | awk '{print $3}')
        log_success "Git $GIT_VERSION found"
        return 0
    fi

    log_warn "Git not found"
    install_git
    GIT_VERSION=$(git --version | awk '{print $3}')
    log_success "Git $GIT_VERSION installed"
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
    NODE_PROVISIONED=true
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
    log_info "Installing pnpm via Corepack..."

    # Node is provisioned before pnpm (check_node runs first), so use its
    # bundled Corepack rather than pnpm's standalone binary. That binary is
    # dynamically linked against libatomic.so.1, which is absent on minimal
    # Linux images and fails there with:
    #   "error while loading shared libraries: libatomic.so.1"
    # Corepack downloads pnpm as a JS package and runs it on Node, so it has no
    # such native dependency.
    local corepack="$INSTALL_DIR/node/bin/corepack"
    if [ ! -x "$corepack" ]; then
        corepack="$(command -v corepack || true)"
    fi
    if [ -z "$corepack" ]; then
        log_error "Corepack not found (ships with Node >= 16.9). Cannot install pnpm."
        exit 1
    fi

    # Never prompt on first download — this runs non-interactively via
    # `curl | bash`. Exported here so build_project's `pnpm install` (same
    # process) also downloads the pinned pnpm without prompting.
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    # Install the pnpm/pnpx shims into $INSTALL_DIR/pnpm — the location the rest
    # of the installer (check_pnpm, build_project, the CLI wrapper) already
    # expects on PATH.
    export PNPM_HOME="$INSTALL_DIR/pnpm"
    mkdir -p "$PNPM_HOME"
    export PATH="$PNPM_HOME:$INSTALL_DIR/node/bin:$PATH"

    if ! "$corepack" enable --install-directory "$PNPM_HOME" pnpm 2>&1; then
        # Older Corepack lacks --install-directory: enable into its default
        # (Node's bin dir, which is already on PATH via check_node).
        if ! "$corepack" enable pnpm 2>&1; then
            log_error "Failed to enable pnpm via Corepack"
            exit 1
        fi
    fi

    # The shim resolves its exact pnpm version from the repo's `packageManager`
    # field at build time; we only confirm it's resolvable now (invoking it
    # here would trigger a premature download outside the project).
    if [ -x "$PNPM_HOME/pnpm" ] || command -v pnpm >/dev/null 2>&1; then
        log_success "pnpm enabled via Corepack"
    else
        log_error "pnpm shim not found after Corepack enable"
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
    if curl -fsSL "$url" -o "$tmp_dir/ripgrep.tar.gz" \
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
# Repository
# ============================================================================

# Query the newest published release tag via the GitHub API. Prints the tag
# (e.g. "v0.1.0") on success, or "main" when there's no release yet / the API
# is unreachable — so a fresh repo with no releases still installs.
resolve_default_ref() {
    local api="https://api.github.com/repos/imzodev/openaidy/releases/latest"
    local tag=""
    tag=$(curl -fsSL "$api" 2>/dev/null | grep -m1 '"tag_name"' \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/') || true
    if [ -n "$tag" ]; then
        printf '%s' "$tag"
    else
        printf 'main'
    fi
}

# Decide which ref to install: an explicit --branch/--tag wins; otherwise the
# latest release tag (falling back to main).
resolve_install_ref() {
    if [ "$BRANCH_EXPLICIT" = true ]; then
        log_info "Installing ref: $BRANCH (explicit)"
        return 0
    fi
    log_info "Resolving latest release..."
    BRANCH="$(resolve_default_ref)"
    if [ "$BRANCH" = "main" ]; then
        log_warn "No published release found — installing from 'main' (development edge)."
    else
        log_success "Latest release: $BRANCH"
    fi
}

clone_or_update_repo() {
    log_info "Preparing repository (ref: $BRANCH)..."

    # Non-interactive SSH: auto-accept an unknown host key and never prompt —
    # this runs under `curl | bash`, where an interactive host-key prompt would
    # hang or read the wrong stdin. Harmless when cloning over HTTPS.
    export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

    if [ -d "$INSTALL_DIR/.git" ] && git -C "$INSTALL_DIR" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
        log_info "Repository already exists — updating to $BRANCH..."
        cd "$INSTALL_DIR"
        # Fetch the requested ref (branch OR tag). FETCH_HEAD then points at it
        # regardless of kind, so a single hard reset pins both cases — the old
        # `--heads` check skipped tags entirely and left re-installs stale.
        if git fetch --tags --force origin "$BRANCH" 2>/dev/null; then
            git checkout -f "$BRANCH" 2>/dev/null || git checkout -f FETCH_HEAD 2>/dev/null || true
            git reset --hard FETCH_HEAD 2>/dev/null || true
        else
            log_warn "Could not fetch '$BRANCH'; keeping the existing checkout."
        fi
    else
        log_info "Cloning repository..."
        mkdir -p "$(dirname "$INSTALL_DIR")"

        # Probe reachability with a real ref (HEAD). Do NOT combine `--heads`
        # with `HEAD`: `--heads` restricts to refs/heads/*, which `HEAD` never
        # matches, so `--exit-code` reports "no refs" (exit 2) even when the
        # remote is perfectly reachable — which wrongly fell through to SSH.
        local repo_url="$REPO_URL_HTTPS"
        if ! git ls-remote --exit-code "$repo_url" HEAD >/dev/null 2>&1; then
            log_warn "HTTPS unreachable, trying SSH..."
            if git ls-remote --exit-code "$REPO_URL_SSH" HEAD >/dev/null 2>&1; then
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
        # --branch accepts a branch OR a tag; --depth 1 keeps it shallow.
        if ! git clone --branch "$BRANCH" --depth 1 "$repo_url" "$INSTALL_DIR" 2>&1; then
            log_error "Failed to clone repository (ref: $BRANCH)"
            log_info "Check your network connection and try again"
            exit 1
        fi
    fi

    log_success "Repository ready at $INSTALL_DIR ($BRANCH)"
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
# OPENAIDY_REPO = code root (used by `start` to resolve server entry).
# On Unix, repo and data share the same dir; the var exists for cross-platform
# parity with the Windows installer where they differ.
OPENAIDY_REPO="${OPENAIDY_REPO:-$HOME/.openaidy}"
# `bin` holds the OpenAidy-managed ripgrep fallback; prepending it
# means code_search / code_glob work even when the system has no rg.
export PATH="$OPENAIDY_REPO/bin:$OPENAIDY_REPO/node/bin:$OPENAIDY_REPO/pnpm:$PATH"
# pnpm is a Corepack shim; never prompt before fetching the pinned version
# (e.g. when `openaidy start --integrated` shells out to pnpm).
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

if [ -f "$OPENAIDY_REPO/packages/cli/bin/openaidy.ts" ]; then
    exec node --import tsx "$OPENAIDY_REPO/packages/cli/bin/openaidy.ts" "$@"
else
    echo "OpenAidy not found at $OPENAIDY_REPO" >&2
    echo "Re-run the installer: curl -fsSL https://openaidy.com/install.sh | bash" >&2
    exit 1
fi
WRAPPER_EOF

    chmod +x "$wrapper"

    if [ "$NODE_PROVISIONED" = true ]; then
        local node_link_dir
        node_link_dir="$(get_node_link_dir)"
        for tool in node npm npx; do
            local target="$INSTALL_DIR/node/bin/$tool"
            local link="$node_link_dir/$tool"
            # Only create if missing or broken — never overwrite existing symlinks
            # (e.g. user-managed nvm/fnm setup).
            if [ ! -e "$link" ]; then
                ln -sf "$target" "$link"
            fi
        done
    fi

    log_success "CLI installed to $wrapper"
    log_info "Run: openaidy --help"
}

# ============================================================================
# Bootstrap Admin Token (PR1)
# ============================================================================

# Generate a 32-byte hex JWT secret. Persisted at $OPENAIDY_HOME/state/install.json
# so subsequent installs reuse it (idempotency per CC-7).
generate_jwt_secret() {
    # Prefer openssl (always available on macOS / most Linux); fall back to /dev/urandom
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        # Portable fallback: 32 random bytes → hex via od
        od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
    fi
}

load_jwt_secret() {
    # If $OPENAIDY_HOME/state/install.json already exists, reuse the secret.
    local manifest="$OPENAIDY_HOME/state/install.json"
    if [ -f "$manifest" ]; then
        # Extract wsTokenSecret via grep + sed (avoid jq dependency).
        local existing
        existing=$(grep -E '"wsTokenSecret"\s*:' "$manifest" | sed -E 's/.*"wsTokenSecret"\s*:\s*"([^"]+)".*/\1/')
        if [ -n "$existing" ]; then
            printf '%s' "$existing"
            return 0
        fi
    fi
    # Otherwise generate a new one and persist it.
    mkdir -p "$OPENAIDY_HOME/state"
    local new_secret
    new_secret=$(generate_jwt_secret)
    # Atomic write to avoid partial files on crash.
    local tmp_manifest="$OPENAIDY_HOME/state/install.json.tmp"
    cat > "$tmp_manifest" <<EOF
{
  "wsTokenSecret": "$new_secret",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    mv "$tmp_manifest" "$manifest"
    chmod 600 "$manifest"
    printf '%s' "$new_secret"
}

run_init() {
    # Run `openaidy init` and capture the token from stdout. Per PR1 R-4 the
    # init command prints exactly one parseable line:
    #   Bootstrap admin token: <jwt>
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
    # Run `openaidy start --server-only` and capture the output.
    #
    # --server-only: the server serves the already-built web bundle itself
    # (apps/web/dist, resolved via the OPENAIDY_REPO fallback), so the whole
    # UI is available on the server's port. We deliberately do NOT spawn the
    # Vite dev server here — that's a development tool, redundant for an
    # installed instance, and a flaky Vite start shouldn't fail the install.
    log_info "Starting the server (this may take up to 30 seconds)..."
    "$link_dir_global/openaidy" start --server-only 2>&1
}

# Capture the wrapper path now so run_init can invoke it (create_cli_wrapper
# hasn't run yet when main invokes run_init).
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
    log_info "Install directory: $INSTALL_DIR"
    echo ""

    check_git
    check_node
    check_pnpm
    check_ripgrep
    resolve_install_ref
    clone_or_update_repo
    build_project
    create_cli_wrapper

    # PR1: ensure JWT secret + generate bootstrap-admin token (idempotent).
    export WS_TOKEN_SECRET
    WS_TOKEN_SECRET=$(load_jwt_secret)
    export OPENAIDY_HOME="$INSTALL_DIR"
    BOOTSTRAP_TOKEN=$(run_init)

    # PR2: start the server and open the browser.
    echo ""
    log_info "Starting the server..."
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
        echo "Server is running at: $START_URL"
        echo ""

        # Auto-open browser (best-effort per NDQ-4)
        case "$(uname -s)" in
            Linux*|WSL*)
                if command -v xdg-open >/dev/null 2>&1; then
                    xdg-open "$START_URL" 2>/dev/null || echo "Open $START_URL in your browser."
                else
                    echo "Open $START_URL in your browser."
                fi
                ;;
            Darwin*)
                open "$START_URL" 2>/dev/null || echo "Open $START_URL in your browser."
                ;;
            *)
                echo "Open $START_URL in your browser."
                ;;
        esac
        echo ""
        echo "Use 'openaidy stop' to stop the server."
    else
        echo "Run 'openaidy start --server-only' to bring the server online,"
        echo "then open http://localhost:3001 in your browser."
        echo ""
        echo "If it still doesn't start, check the log at:"
        echo "  $OPENAIDY_HOME/logs/server.log"
    fi
    echo ""
}

main