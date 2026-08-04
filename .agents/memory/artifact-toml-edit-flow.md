---
name: artifact.toml edit flow
description: Both Edit and WriteFile tools are blocked for artifact.toml; must use verifyAndReplaceArtifactToml callback via CodeExecution with a temp file.
---

# Correct Flow for Editing artifact.toml

Both `Edit` and `WriteFile` tools are blocked for `.replit-artifact/artifact.toml` with the error:
"Direct edits to artifact.toml are not allowed."

**Why:** The platform enforces a verification step before accepting artifact config changes.

**How to apply:**

```javascript
// In CodeExecution — MUST be inside "use impure" function
const result = await (async () => {
  "use impure";
  const fs = await import("node:fs/promises");
  const tempPath = "/home/runner/workspace/artifacts/research-copilot/.replit-artifact/artifact.edit.toml";
  // NOTE: temp file must be in same .replit-artifact/ directory, NOT /tmp/
  await fs.writeFile(tempPath, newTomlContent, "utf8");
  return { tempPath };
})();

const replaced = await verifyAndReplaceArtifactToml({
  tempFilePath: result.tempPath,
  artifactTomlPath: "/home/runner/workspace/artifacts/research-copilot/.replit-artifact/artifact.toml",
});
// { success: true } on success
```

Key constraint: temp file must be in the same `.replit-artifact/` directory (not `/tmp/`).
The `verifyAndReplaceArtifactToml` call is OUTSIDE the "use impure" function (it's a registered callback).
