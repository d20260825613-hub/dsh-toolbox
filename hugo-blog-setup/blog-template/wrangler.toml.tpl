# =====================================================================
#  Cloudflare Pages project config, read by the Wrangler CLI
#  Docs: https://developers.cloudflare.com/pages/functions/wrangler-configuration/
#  Requires Wrangler >= 3.45.0
#
#  NOTE: this file is generated WITHOUT Chinese characters on purpose.
#  deploy.ps1 parses it with PowerShell, and PowerShell decodes BOM-less
#  non-ASCII files using the system code page, which can corrupt values.
#  Chinese explanations for every field are in README.md.
# =====================================================================

# [Project name] = free subdomain prefix -> https://<name>.pages.dev
#   lowercase letters, digits and hyphens only; must be globally unique.
#   Change this to change your public URL (that means a different project).
name = "__PROJECT__"

# Build output directory: Hugo writes here (deploy.ps1 builds before upload)
pages_build_output_dir = "./public"

# Compatibility date: plain static site, no Functions involved, but Wrangler
# needs a config baseline. On project creation just use today's date (YYYY-MM-DD).
compatibility_date = "__TODAY__"

# ---------------------------------------------------------------------
#  Optional: pin the absolute site URL (used in RSS / sitemap / og:url)
#    empty  -> deploy.ps1 uses https://<name>.pages.dev/
#    filled -> this value wins (e.g. after binding your own domain)
# ---------------------------------------------------------------------
[vars]
PUBLIC_BASE_URL = ""

# ---------------------------------------------------------------------
#  Notes
# ---------------------------------------------------------------------
#  1) Pure static site: no Pages Functions, so no main / kv_namespaces /
#     d1_databases bindings are needed here.
#  2) Once this file is used as project configuration, do not edit the same
#     fields in the Cloudflare dashboard: this file is the source of truth.
#  3) No need to create the project by hand: "wrangler pages deploy" inside
#     deploy.ps1 creates it on first upload.
