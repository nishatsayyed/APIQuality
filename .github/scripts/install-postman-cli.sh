#!/bin/sh

set -o errexit
set -o nounset

# Default verbosity (false = quiet, true = verbose)
VERBOSE=false
SYSTEM_ERROR=""

# Environment for telemetry
ENVIRONMENT="beta"

# Function to report events to Sentry (both success and errors)
# This function will NEVER cause the installation to fail
report_event() {
    level="$1"
    message="$2"
    os_tag="$3"
    transaction_type="$4"
    download_url="$5"
    version="${6:-}"

    # Build tags object
    tags_json="\"os\": \"$os_tag\", \"environment\": \"$ENVIRONMENT\""
    if [ -n "$version" ]; then
        tags_json="$tags_json, \"version\": \"$version\""
    fi

    # Only try to report if curl is available - fail completely silently
    if command -v curl >/dev/null 2>&1; then
        curl --silent --fail \
          --location --request POST \
          --connect-timeout 3 --max-time 5 \
          --retry 0 \
          --header 'Content-Type: application/json' \
          --data-raw "{
              \"level\": \"$level\",
              \"transaction\": \"$transaction_type\",
              \"tags\": {
                  $tags_json
              },
              \"message\": \"$message\"
          }" \
          'https://o1224273.ingest.sentry.io/api/4504100877828096/store/?sentry_key=0b9fcaeae27d4918b933ed747b1a1047' >/dev/null 2>&1 || true
    fi
}

# Function to report crashes to Sentry
report_crash() {
    error_message="$1"
    os_tag="$2"
    download_url="${3:-unknown}"
    version="${4:-}"

    # Report the error event (silently)
    report_event "error" "$error_message" "$os_tag" "postman-cli-install" "$download_url" "$version"

    SYSTEM_ERROR="true"
    print_msg error "The Postman CLI couldn't be installed. $error_message"
    exit 1
}

# Function to report successful installations to Sentry
report_success() {
    os_tag="$1"
    version="$2"
    download_url="$3"

    success_message="Postman CLI installed successfully"
    if [ -n "$version" ]; then
        success_message="Postman CLI v$version installed successfully"
    fi

    # Report the success event (silently)
    report_event "info" "$success_message" "$os_tag" "postman-cli-install-success" "$download_url" "$version"
}

# Unified print function
print_msg() {
    case "$1" in
        info|warning) [ "$VERBOSE" = true ] && printf "[$(echo "$1" | tr '[:lower:]' '[:upper:]')] %s\n" "$2" >&2 || true ;;
        error) printf "[ERROR] %s\n" "$2" >&2 ;;
        success) printf "%s\n" "$2" >&2 ;;
        *) printf "[UNKNOWN] %s\n" "$2" >&2 ;;
    esac
}

# Function to parse command line arguments
parse_args() {
    while [ $# -gt 0 ]; do
        case $1 in
            --verbose|-v) VERBOSE=true; shift ;;
            *) report_crash "Unknown option: $1" "invalid_argument" "unknown" ;;
        esac
    done
}

# Function to detect OS and architecture
detect_platform() {
    os_type=""
    arch_type=""

    # Detect OS
    case "$(uname -s)" in
        Linux*)     os_type="linux" ;;
        Darwin*)    os_type="macos" ;;
        *)
            report_crash "Unsupported operating system: $(uname -s)" "unknown" "unknown"
            ;;
    esac

    # Detect architecture
    case "$(uname -m)" in
        x86_64|amd64)
            arch_type="amd64"
            ;;
        arm64|aarch64)
            arch_type="arm64"
            ;;
        *)
            if [ "$os_type" = "linux" ]; then
                report_crash "Only x64/arm64 are supported for Linux at this time" "linux_unsupported_arch" "unknown"
            else
                report_crash "Unsupported architecture: $(uname -m)" "${os_type}_unsupported_arch" "unknown"
            fi
            ;;
    esac

    # Log individual components
    print_msg info "Detected OS: $os_type"
    print_msg info "Detected architecture: $arch_type"

    echo "${os_type}_${arch_type}"
}

# Function to get download URL based on platform
# for canary builds just add a query param to the url `?channel=canary`
get_download_url() {
    platform="$1"
    case "$platform" in
        linux_amd64)    echo "https://dl-cli.pstmn-beta.io/download/latest/linux64" ;;
        linux_arm64)    echo "https://dl-cli.pstmn-beta.io/download/latest/linux_arm64" ;;
        macos_amd64)    echo "https://dl-cli.pstmn-beta.io/download/latest/osx_64" ;;
        macos_arm64)    echo "https://dl-cli.pstmn-beta.io/download/latest/osx_arm64" ;;
        *)
            os_tag="$(echo "$platform" | cut -d'_' -f1)"
            report_crash "Unsupported platform: $platform" "${os_tag}_unsupported" "unknown"
            ;;
    esac
}

# Function to install on Unix-like systems (Linux/macOS)
install_unix() {
    platform="$1"
    url="$2"
    os_tag=""

    # Set OS tag for crash reporting
    case "$platform" in
        linux_amd64)    os_tag="linux_amd64" ;;
        linux_arm64)    os_tag="linux_arm64" ;;
        macos_amd64)    os_tag="mac_intel" ;;
        macos_arm64)    os_tag="mac_arm" ;;
        *)              os_tag="unknown" ;;
    esac

    # Set up trap for user interruption
    trap "report_crash \"USER_ABORT\" \"$os_tag\" \"$url\"" INT TERM

    print_msg info "Installing Postman CLI for $platform..."

    # Set installation prefix
    prefix="/usr/local"

    # Create temporary directory
    # Try mktemp -d first, fallback to creating our own temp dir
    if command -v mktemp >/dev/null 2>&1; then
        tmp_dir="$(mktemp -d)"
    else
        # Fallback for systems without mktemp
        tmp_dir="/tmp/postman-cli-install-$$"
        mkdir -p "$tmp_dir" || report_crash "Failed to create temporary directory" "$os_tag" "$url"
    fi
    cleanup() {
        if [ -n "${tmp_dir:-}" ] && [ -d "$tmp_dir" ]; then
            rm -rf "$tmp_dir"
        fi
    }
    trap cleanup EXIT

    print_msg info "Downloading from $url..."

    # Download the archive
    archive_file=""
    if [ "$platform" = "linux_amd64" ] || [ "$platform" = "linux_arm64" ]; then
        archive_file="$tmp_dir/postman-cli.tar.gz"

        # Try curl first, then wget
        if command -v curl >/dev/null 2>&1; then
            # --fail ensures HTTP 4xx/5xx cause curl to exit non-zero (instead of saving HTML error pages)
            # --retry-all-errors retries on those HTTP errors too, not just transport errors
            curl --fail --location --retry 10 --retry-all-errors --retry-delay 5 --output "$archive_file" "$url" || report_crash "Failed to download Postman CLI" "$os_tag" "$url"
        elif command -v wget >/dev/null 2>&1; then
            # --tries=10 + --waitretry=5 mirrors curl retry behaviour; wget already fails on 4xx/5xx by default
            wget --tries=10 --waitretry=5 --output-document "$archive_file" "$url" || report_crash "Failed to download Postman CLI" "$os_tag" "$url"
        else
            report_crash "You need either cURL or wget installed on your system" "$os_tag" "$url"
        fi

        # Validate the download is actually a gzip archive (magic bytes: 1f 8b) before extracting.
        # Guards against CDN returning an HTML error page with a 200 status.
        if ! (head -c 2 "$archive_file" | od -An -tx1 | tr -d ' \n' | grep -q '^1f8b'); then
            report_crash "Downloaded file is not a valid gzip archive (CDN likely returned an error page)" "$os_tag" "$url"
        fi

        print_msg info "Extracting tar.gz archive..."
        # Use POSIX-compatible tar options
        (cd "$tmp_dir" && tar -xf "$archive_file") || report_crash "Failed to extract Postman CLI archive" "$os_tag" "$url"

    else
        # macOS - download zip file
        archive_file="$tmp_dir/postman-cli.zip"

        if command -v curl >/dev/null 2>&1; then
            # --fail + --retry-all-errors: retry on HTTP 4xx/5xx instead of saving an HTML error page
            curl --fail --location --retry 10 --retry-all-errors --retry-delay 5 --output "$archive_file" "$url" || report_crash "Failed to download Postman CLI" "$os_tag" "$url"
        else
            report_crash "curl is required for macOS installation" "$os_tag" "$url"
        fi

        # Validate the download is actually a zip archive (magic bytes: 50 4b) before extracting.
        if ! (head -c 2 "$archive_file" | od -An -tx1 | tr -d ' \n' | grep -q '^504b'); then
            report_crash "Downloaded file is not a valid zip archive (CDN likely returned an error page)" "$os_tag" "$url"
        fi

        print_msg info "Extracting zip archive..."
        if command -v ditto >/dev/null 2>&1; then
            ditto -x -k "$archive_file" "$tmp_dir" || report_crash "Failed to extract Postman CLI archive with ditto" "$os_tag" "$url"
        else
            # Fallback to unzip if ditto is not available
            if [ "$VERBOSE" = true ]; then
                unzip "$archive_file" -d "$tmp_dir" || report_crash "Failed to extract Postman CLI archive with unzip" "$os_tag" "$url"
            else
                unzip -q "$archive_file" -d "$tmp_dir" || report_crash "Failed to extract Postman CLI archive with unzip" "$os_tag" "$url"
            fi
        fi
    fi

    # Check if we need sudo
    run_cmd="sudo"
    if test -d "$prefix/bin" && test -w "$prefix/bin"; then
        run_cmd="eval"
    elif test -d "$prefix" && test -w "$prefix"; then
        run_cmd="eval"
    fi

    if [ "$run_cmd" = "sudo" ] && ! command -v sudo >/dev/null 2>&1; then
        report_crash "You do not have enough permissions to write to $prefix and sudo is not available" "$os_tag" "$url"
    fi

    print_msg info "Installing to $prefix/bin/postman..."

    # Prepare man page installation command if man page exists
    man_install_cmd=""
    if [ -f "$tmp_dir/postman.1" ]; then
        print_msg info "Installing man page to $prefix/share/man/man1/postman.1..."
        man_install_cmd=" && mkdir -p \"$prefix/share/man/man1\" && cp \"$tmp_dir/postman.1\" \"$prefix/share/man/man1/postman.1\" && chmod 644 \"$prefix/share/man/man1/postman.1\""
    fi

    # Prepare lib directory installation command if lib exists (contains DuckDB native bindings)
    # Note: $prefix/bin/lib is a Postman CLI-specific path (not a standard Linux path)
    # The binary expects lib/node_modules relative to its location, so this is safe to overwrite
    lib_install_cmd=""
    if [ -d "$tmp_dir/lib" ]; then
        print_msg info "Installing native libraries to $prefix/bin/lib..."
        lib_install_cmd=" && rm -rf \"$prefix/bin/lib\" 2>/dev/null; cp -R \"$tmp_dir/lib\" \"$prefix/bin/\""
    fi

    # Show installation message before password prompt (always visible)
    if [ "$run_cmd" = "sudo" ]; then
        printf "\nInstalling Postman CLI to %s/bin (requires admin privileges)\n" "$prefix" >&2
    fi

    # Create directory and install binary (and man page if exists)
    # Use portable approach: mkdir + cp + chmod instead of install command
    if [ "$run_cmd" = "sudo" ]; then
        # Combine operations in single sudo call to avoid multiple password prompts
        combined_cmd="mkdir -p \"$prefix/bin\" && cp \"$tmp_dir/postman-cli\" \"$prefix/bin/postman\" && chmod 755 \"$prefix/bin/postman\"$man_install_cmd$lib_install_cmd"
        if [ "$VERBOSE" = false ]; then
            "$run_cmd" sh -c "$combined_cmd" 2>/dev/null || report_crash "Failed to install Postman CLI to $prefix/bin" "$os_tag" "$url"
        else
            "$run_cmd" sh -c "$combined_cmd" || report_crash "Failed to install Postman CLI to $prefix/bin" "$os_tag" "$url"
        fi
    else
        # No sudo needed
        if [ "$VERBOSE" = false ]; then
            "$run_cmd" mkdir -p "$prefix/bin" 2>/dev/null || report_crash "Failed to create $prefix/bin directory" "$os_tag" "$url"
            "$run_cmd" cp "$tmp_dir/postman-cli" "$prefix/bin/postman" 2>/dev/null || report_crash "Failed to copy Postman CLI to $prefix/bin" "$os_tag" "$url"
            "$run_cmd" chmod 755 "$prefix/bin/postman" 2>/dev/null || report_crash "Failed to set permissions on Postman CLI" "$os_tag" "$url"
            # Install man page separately if no sudo is needed
            if [ -n "$man_install_cmd" ]; then
                sh -c "mkdir -p \"$prefix/share/man/man1\" && cp \"$tmp_dir/postman.1\" \"$prefix/share/man/man1/postman.1\" && chmod 644 \"$prefix/share/man/man1/postman.1\"" 2>/dev/null || print_msg warning "Failed to install man page (non-critical)"
            fi
            # Install lib directory separately if no sudo is needed
            if [ -d "$tmp_dir/lib" ]; then
                rm -rf "$prefix/bin/lib" 2>/dev/null || true
                cp -R "$tmp_dir/lib" "$prefix/bin/" 2>/dev/null || print_msg warning "Failed to install native libraries (non-critical)"
            fi
        else
            "$run_cmd" mkdir -p "$prefix/bin" || report_crash "Failed to create $prefix/bin directory" "$os_tag" "$url"
            "$run_cmd" cp "$tmp_dir/postman-cli" "$prefix/bin/postman" || report_crash "Failed to copy Postman CLI to $prefix/bin" "$os_tag" "$url"
            "$run_cmd" chmod 755 "$prefix/bin/postman" || report_crash "Failed to set permissions on Postman CLI" "$os_tag" "$url"
            # Install man page separately if no sudo is needed
            if [ -n "$man_install_cmd" ]; then
                sh -c "mkdir -p \"$prefix/share/man/man1\" && cp \"$tmp_dir/postman.1\" \"$prefix/share/man/man1/postman.1\" && chmod 644 \"$prefix/share/man/man1/postman.1\"" || print_msg warning "Failed to install man page (non-critical)"
            fi
            # Install lib directory separately if no sudo is needed
            if [ -d "$tmp_dir/lib" ]; then
                rm -rf "$prefix/bin/lib" 2>/dev/null || true
                cp -R "$tmp_dir/lib" "$prefix/bin/" || print_msg warning "Failed to install native libraries (non-critical)"
            fi
        fi
    fi


    print_msg info "The Postman CLI has been installed successfully!"
    print_msg info "You can now use the 'postman' command."

    # Check if man page was installed and inform user
    if [ -f "$prefix/share/man/man1/postman.1" ]; then
        print_msg info "Man page installed - try 'man postman' for help."

        # Check if installed path is in MANPATH (only if MANPATH is set)
        if [ "${MANPATH:-}" ] && ! echo "$MANPATH" | grep -q "$prefix/share/man"; then
            print_msg info "Note: You may need to add $prefix/share/man to your MANPATH"
            print_msg info "      export MANPATH=\"$prefix/share/man:\$MANPATH\""
        fi
    fi

    # Try to get and display the version
    version=""
    if command -v postman >/dev/null 2>&1; then
        version=$(postman --version 2>/dev/null || echo "")
    elif [ -x "$prefix/bin/postman" ]; then
        version=$("$prefix/bin/postman" --version 2>/dev/null || echo "")
    fi

    if [ -n "$version" ]; then
        print_msg info "Installed version: $version"
    fi

    # Clear the trap and cleanup manually before function exits
    trap - EXIT
    cleanup
}

# Main installation function
main() {
    # Parse command line arguments
    parse_args "$@"

    # Detect platform
    platform=$(detect_platform)
    print_msg info "Detected platform: $platform"

    # Set OS tag for success tracking (same logic as in install_unix)
    os_tag=""
    case "$platform" in
        linux_amd64)    os_tag="linux_amd64" ;;
        linux_arm64)    os_tag="linux_arm64" ;;
        macos_amd64)    os_tag="mac_intel" ;;
        macos_arm64)    os_tag="mac_arm" ;;
        *)              os_tag="unknown" ;;
    esac

    # Get download URL
    url=$(get_download_url "$platform")
    install_unix "$platform" "$url"

    # Get version for final success message and tracking
    version=""
    if command -v postman >/dev/null 2>&1; then
        version=$(postman --version 2>/dev/null || echo "")
    fi

        # Always show success message with version if available only if no system error occurred
    if [ -z "$SYSTEM_ERROR" ]; then
        # Report successful installation for tracking (silently)
        report_success "$os_tag" "$version" "$url"

        if [ -n "$version" ]; then
            print_msg success "The Postman CLI v$version has been installed successfully"
        else
            print_msg success "The Postman CLI has been installed successfully"
        fi
    fi
}

# Run main function
main "$@"
