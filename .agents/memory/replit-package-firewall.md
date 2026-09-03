---
name: Replit package firewall blocks
description: Handling frozen dependency installs blocked by Replit's internal package firewall
---

When a frozen pnpm install receives `403 Forbidden` from `package-firewall.replit.local` for one locked package with “No authorization header was set,” treat it as a Replit security-infrastructure block, not a repository registry configuration problem. Do not bypass the firewall, add fake credentials, or alter the lockfile solely to work around it. Replit documents that package exceptions cannot be manually allowlisted.

**Why:** Bypassing the firewall would remove a supply-chain protection, while changing a locked dependency would violate reproducibility and may expand the scope beyond an environment fix.

**How to apply:** First resolve any independent runtime incompatibility using a supported Replit module. If the same package-only 403 remains, report the platform blocker and defer installation/typecheck until Replit clears or corrects the block.