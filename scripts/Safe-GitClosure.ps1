#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ExpectedBaseline,
    [Parameter(Mandatory=$true)][string[]]$ApprovedFiles,
    [Parameter(Mandatory=$true)][string]$CommitMessage,
    [string]$RepositoryPath = (Split-Path -Parent $PSScriptRoot),
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$protected = 'docs/HanaPure_Website_Secure_Connectivity_Readiness_Audit.md'
$protectedHash = 'D78599C5D11F7068C3F9B64211BF7505BE5521E1AD7B988458CC5F935BAAB02C'
$phase = 'PRECONDITION'
function Invoke-ClosureGit([string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $output = @(& git -c core.quotePath=false @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments[0]) failed: $($output -join ' ')" }
    # Native stderr is an ErrorRecord in Windows PowerShell 5.1. Do not let
    # successful Git warnings become path/protocol data (or add LF separators).
    $stdout = @(foreach ($item in $output) {
        if ($item -is [System.Management.Automation.ErrorRecord]) {
            Write-Verbose ([string]$item)
        } else {
            [string]$item
        }
    })
    return ($stdout -join "`n")
}
function Names([string[]]$Arguments) {
    $raw = Invoke-ClosureGit $Arguments
    if (!$raw) { return }
    foreach ($name in $raw.Split([char]0)) {
        if ($name) {
            if ($name -match '[\x00-\x1f\x7f]') { throw 'Control characters in Git paths are unsupported.' }
            $name
        }
    }
}
function SameSet($Actual, $Expected, [string]$Label) {
    if (@($Actual).Count -ne @($Expected).Count -or @(Compare-Object @($Actual) @($Expected) -CaseSensitive).Count) {
        throw "$Label does not match the approved exact file list. Actual: $($Actual -join ', ')"
    }
}
function ProtectedCheck {
    if (@(Names @('ls-files','-z','--',":(literal)$protected")).Count) { throw 'Protected audit is tracked or staged.' }
    if ((Invoke-ClosureGit @('status','--porcelain=v1','--untracked-files=all','--',":(literal)$protected")) -cne "?? $protected") {
        throw 'Protected audit must remain untracked and unstaged.'
    }
    if ((Get-FileHash -LiteralPath (Join-Path $RepositoryPath $protected) -Algorithm SHA256).Hash -cne $protectedHash) {
        throw 'Protected audit SHA-256 mismatch.'
    }
}
function StateCheck([bool]$Staged, [bool]$Closed) {
    ProtectedCheck
    $changed = @(Names @('diff','--name-only','--no-renames','-z'))
    $cached = @(Names @('diff','--cached','--name-only','--no-renames','-z'))
    $untracked = @(Names @('ls-files','--others','--exclude-standard','-z')) | Where-Object { $_ -cne $protected }
    foreach ($path in @($changed) + @($cached) + @($untracked)) {
        if ($approved -cnotcontains $path) { throw "Outside approved scope: $path" }
    }
    # Also catches intent-to-add, conflicts and rename source/destination records.
    $status = Invoke-ClosureGit @('status','--porcelain=v1','--untracked-files=all','--no-renames','-z')
    foreach ($record in $status.Split([char]0)) {
        if (!$record) { continue }
        if ($record.Length -lt 4) { throw 'Invalid status record.' }
        $code = $record.Substring(0,2); $path = $record.Substring(3)
        if ($path -ceq $protected -and $code -ceq '??') { continue }
        if ($approved -cnotcontains $path) { throw "Outside approved status scope: $path" }
        if ($code -match 'U|AA|DD|R|C') { throw "Unresolved or unsupported status: $record" }
        if (!$Staged -and !$Closed -and $code[0] -ne ' ' -and $code -ne '??') { throw "Index must be empty: $record" }
    }
    if ($Closed) {
        if (@($changed).Count + @($cached).Count + @($untracked).Count) { throw 'Working tree/index changed during closure.' }
    } elseif ($Staged) {
        SameSet $cached $approved 'Staged files'
        if (@($changed).Count + @($untracked).Count) { throw 'Unstaged changes remain after staging.' }
    } else {
        if ($cached.Count) { throw 'Index must be empty.' }
        $actual = @(@($changed) + @($untracked) | Sort-Object -Unique)
        SameSet $actual $approved 'Pending files'
    }
}
function IdentityCheck([string]$Head, [string]$Origin, [string]$Counts) {
    if ((Invoke-ClosureGit @('symbolic-ref','--short','HEAD')) -cne 'main') { throw 'Branch must be main.' }
    if ((Invoke-ClosureGit @('rev-parse','HEAD')) -cne $Head) { throw 'Unexpected HEAD.' }
    if ((Invoke-ClosureGit @('rev-parse','refs/remotes/origin/main')) -cne $Origin) { throw 'Unexpected origin/main.' }
    if ((Invoke-ClosureGit @('rev-list','--left-right','--count','HEAD...refs/remotes/origin/main')) -notmatch $Counts) { throw 'Unexpected ahead/behind.' }
    $remote = Invoke-ClosureGit @('ls-remote','--exit-code','origin','refs/heads/main')
    if ($remote -cne "$Origin`trefs/heads/main") { throw 'Live remote main differs from expected origin/main.' }
}
$pushedLocation = $false
try {
    if ($ExpectedBaseline -notmatch '^[0-9a-fA-F]{40}$') { throw 'ExpectedBaseline must be a full 40-character commit SHA.' }
    $ExpectedBaseline = $ExpectedBaseline.ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($CommitMessage) -or $CommitMessage.Contains([char]0)) { throw 'Commit message must be nonempty and contain no NUL.' }
    $approved = @($ApprovedFiles)
    if (!$approved.Count) { throw 'ApprovedFiles must not be empty.' }
    foreach ($path in $approved) {
        if ([string]::IsNullOrWhiteSpace($path) -or $path -match '[\\:\x00-\x1f\x7f*?]' -or $path.StartsWith('/') -or $path -match '(^|/)\.{1,2}(/|$)|//|/$|(^|/)\.git(/|$)' -or $path -ieq $protected) {
            throw "Unsafe or protected approved path: $path"
        }
        if (Test-Path -LiteralPath (Join-Path $RepositoryPath $path) -PathType Container) { throw "Directory approval is prohibited: $path" }
    }
    if (@($approved | Sort-Object -Unique).Count -ne $approved.Count) { throw 'Duplicate approved paths (including case aliases).' }
    foreach ($variable in Get-ChildItem Env:GIT*) {
        if ($variable.Name -notin @('GIT_PAGER','GIT_TERMINAL_PROMPT')) { throw "Git environment override prohibited: $($variable.Name)" }
    }
    $RepositoryPath = (Resolve-Path -LiteralPath $RepositoryPath).Path
    Push-Location -LiteralPath $RepositoryPath; $pushedLocation = $true
    if ((Invoke-ClosureGit @('rev-parse','--show-toplevel')).Replace('\','/').TrimEnd('/') -ine $RepositoryPath.Replace('\','/').TrimEnd('/')) { throw 'RepositoryPath must be the repository root.' }
    foreach ($marker in @('MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer','index.lock')) {
        if (Test-Path -LiteralPath (Invoke-ClosureGit @('rev-parse','--git-path',$marker))) { throw "Git operation/lock present: $marker" }
    }
    IdentityCheck $ExpectedBaseline $ExpectedBaseline '^0\s+0$'
    StateCheck $false $false
    $null = Invoke-ClosureGit @('diff','--cached','--check')
    $null = Invoke-ClosureGit @('diff','--check')
    Write-Output 'PRECONDITION PASS: main, baseline, live origin/main, 0/0, empty index, exact scope, protected audit.'
    if (!$Execute) {
        Write-Output 'VALIDATED / NOT STAGED / NOT COMMITTED / NOT PUSHED'
        Write-Output "Approved files:`n$($approved -join "`n")"
        return
    }
    $phase = 'STAGE'
    foreach ($path in $approved) { $null = Invoke-ClosureGit @('add','--',":(literal)$path") }
    StateCheck $true $false
    $null = Invoke-ClosureGit @('diff','--cached','--check')
    $tree = Invoke-ClosureGit @('write-tree')
    IdentityCheck $ExpectedBaseline $ExpectedBaseline '^0\s+0$'
    StateCheck $true $false
    $phase = 'COMMIT'
    $null = Invoke-ClosureGit @('commit','-m',$CommitMessage)
    $commit = Invoke-ClosureGit @('rev-parse','HEAD')
    if ($commit -ceq $ExpectedBaseline -or (Invoke-ClosureGit @('rev-list','--parents','-n','1','HEAD')) -cne "$commit $ExpectedBaseline") { throw 'Commit must be exactly one child of baseline.' }
    if ((Invoke-ClosureGit @('rev-parse','HEAD^{tree}')) -cne $tree) { throw 'Committed tree differs from validated index.' }
    $committed = @(Names @('diff-tree','--no-commit-id','--name-only','--no-renames','-r','-z','HEAD'))
    SameSet $committed $approved 'Committed files'
    StateCheck $false $true
    IdentityCheck $commit $ExpectedBaseline '^1\s+0$'
    $phase = 'PUSH'
    $null = Invoke-ClosureGit @('push','origin','HEAD:refs/heads/main')
    $phase = 'POST-PUSH'
    IdentityCheck $commit $commit '^0\s+0$'
    StateCheck $false $true
    Write-Output "COMMITTED / PUSHED / VERIFIED (Command Center acceptance remains manual)`nHEAD == origin/main: $commit`nAhead/behind: 0/0"
    Write-Output "Committed files:`n$($committed -join "`n")"
    Write-Output (Invoke-ClosureGit @('status','--short','--untracked-files=all'))
} catch {
    Write-Output "STOP [$phase]: $($_.Exception.Message)"
    Write-Output 'No automatic reset, restore, clean, unstage, rollback, force push or retry. Inspect status before any recovery.'
    throw
} finally {
    if ($pushedLocation) { Pop-Location }
}
