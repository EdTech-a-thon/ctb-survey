#!/usr/bin/env bash
# on-authed.sh — delivery hook for the OAuth broker.
#
# The broker calls this AFTER a successful Google authorization:
#
#     on-authed.sh <credsFilePath> <originSubdomain>
#
#   $1  credsFilePath   absolute path to a freshly-written clasp v3 creds file
#                       (JSON: { tokens: { default: { ...authorized_user... } } })
#                       This is a temp file; move/consume it. Chmod 600.
#   $2  originSubdomain the host that started the flow, e.g.
#                       "ctb-survey.dev.edtechathon.com"
#
# Contract:
#   * Exit 0 on success -> user sees "Google connected".
#   * Exit non-zero + stderr on failure -> user sees the error, token NOT lost
#     (broker leaves the temp file in place for retry/debug).
#
# This reference implementation maps the origin subdomain to a destination
# clasprc path and copies the file there. Replace the DEST logic with however
# your platform routes credentials to the right project/VM (scp, API call,
# secrets manager, etc.).

set -euo pipefail

CREDS_FILE="${1:?usage: on-authed.sh <credsFilePath> <originSubdomain>}"
ORIGIN="${2:?usage: on-authed.sh <credsFilePath> <originSubdomain>}"

if [[ ! -f "$CREDS_FILE" ]]; then
  echo "creds file not found: $CREDS_FILE" >&2
  exit 1
fi

# --- map origin -> destination ---------------------------------------------
# Derive the project slug from the subdomain's first label.
#   ctb-survey.dev.edtechathon.com -> ctb-survey
PROJECT="${ORIGIN%%.*}"

# Where this project's clasp credentials should live. Override with env vars.
# Default: this same VM's ~/.clasprc.json (single-project case).
DEST="${CLASPRC_DEST:-$HOME/.clasprc.json}"

# For a multi-project platform you might instead do something like:
#   DEST="/srv/projects/${PROJECT}/.clasprc.json"
# or push to a remote VM:
#   scp "$CREDS_FILE" "deploy@${PROJECT}.internal:~/.clasprc.json"

# --- deliver ----------------------------------------------------------------
install -m 600 "$CREDS_FILE" "$DEST"
rm -f "$CREDS_FILE"

echo "delivered creds for project '${PROJECT}' (origin ${ORIGIN}) -> ${DEST}"
