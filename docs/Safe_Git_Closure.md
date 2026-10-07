# HanaPure Website Safe Git Closure

Run in Windows PowerShell 5.1 or newer with Git installed. No dependencies are installed. This tool does not run application tests: Codex must complete milestone implementation/tests and Website Command Center must approve the baseline, exact file list and message first.

## One command per approved milestone

From `C:\Users\Enigma\hanapure-shop`, validate first (read-only; contacts origin with `ls-remote`, does not fetch):

```powershell
& .\scripts\Safe-GitClosure.ps1 -ExpectedBaseline 'ce53804f64b13c91c446970e522e3a5bb39523f8' -ApprovedFiles @('scripts/Safe-GitClosure.ps1','docs/Safe_Git_Closure.md','tests/Safe-GitClosure.Tests.ps1') -CommitMessage 'chore: add safe website git closure tool'
```

After separate approval from Kimin / Website Command Center, run the same command with `-Execute` appended. Running that switch authorizes stage, commit and push in this invocation. The example three-file scope is for this tool milestone only; replace baseline, list and message for every later milestone. Use full SHA and exact repository-relative paths with `/`. Arrays preserve filenames with spaces; literal Git pathspecs preserve `[locale]`. List both paths for a rename, which is handled as deletion/addition. Never pass directories, wildcards, the protected audit or `.`.

## Gates and STOP behavior

- Require repository root, `main`, full expected HEAD == origin/main, ahead/behind 0/0 and live remote main equal to baseline. Reject Git environment overrides and merge/rebase/cherry-pick/revert/lock states.
- Require an empty index (including intent-to-add), no conflicts, and pending changed/untracked files exactly equal to approvals. Ignored files are excluded by Git; missing or ignored approvals cannot pass exact scope.
- Protected audit must be untracked/unstaged, present and hash exactly `D78599C5D11F7068C3F9B64211BF7505BE5521E1AD7B988458CC5F935BAAB02C`. It is the sole allowed unapproved untracked file.
- Stage only each approved literal path, require exact staged list and no remaining unstaged changes; `git diff --cached --check` must pass. Read-only validation also checks tracked unstaged whitespace; new untracked files receive cached whitespace validation only after explicit execution.
- Before commit repeat identity and scope checks. After commit require exactly one parent equal to baseline, committed tree equal to validated index and committed file list equal to approvals; clean approved scope and unchanged audit. Before push require ahead/behind 1/0 and live remote still at baseline.
- Push `HEAD:refs/heads/main` to origin without force. Afterwards require HEAD == origin/main == live remote main, ahead/behind 0/0 and clean scope except protected audit. Print status, commit SHA and committed list. Command Center acceptance / authoritative baseline update remains manual.

Any failed Git command or check throws and stops; PowerShell process invocation returns failure. No auto-fix, unstage, rollback, reset, clean, force push or retry. A failure after staging can leave files staged; after commit can leave a local commit; after push can mean the remote was updated even if post-check failed. Inspect `git status`, HEAD, origin/main and live remote before requesting recovery approval. Do not blindly rerun the old baseline after a commit.

Keep editors and other Git processes idle while executing. Checks detect scope/tree changes, including changes made by hooks; they do not provide an atomic lock against another process or prevent hook side effects. A remote race causes ordinary push rejection or failed verification. Authentication/network failures also STOP. Existing Git identity, hooks and authentication are used unchanged.

## Tests

```powershell
& .\tests\Safe-GitClosure.Tests.ps1
```

Tests substitute Git with a read-only mock and exercise valid validation, wrong baseline/branch/ahead/remote, tracked audit, whitespace failure, staged/outside changes and invalid approvals. They never stage, commit or push in the real repository. Real read-only validation should also be run with the actual approved scope.
