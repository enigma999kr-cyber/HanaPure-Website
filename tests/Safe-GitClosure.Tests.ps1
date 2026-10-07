#requires -Version 5.1
# Mocked closure tests plus native read-only path parsing. No real add/commit/push.
$ErrorActionPreference = 'Stop'
Write-Output "PowerShell $($PSVersionTable.PSVersion)"
$tool = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/Safe-GitClosure.ps1'
$baseline = 'ce53804f64b13c91c446970e522e3a5bb39523f8'
$repo = Split-Path -Parent $PSScriptRoot
$protected = 'docs/HanaPure_Website_Secure_Connectivity_Readiness_Audit.md'
$global:ClosureTestCalls = @()
function global:git {
    $a = @($args)[2..($args.Count-1)]
    $global:ClosureTestCalls += ($a -join ' ')
    $global:LASTEXITCODE = 0
    switch ($a[0]) {
        'rev-parse' {
            switch ($a[1]) {
                '--show-toplevel' { $repo.Replace('\','/') }
                '--git-path' { Join-Path $repo ('nonexistent-test-marker-' + $a[2]) }
                'HEAD^{tree}' { if ($global:ClosureTestScenario -eq 'tree-change') { 'changed-tree' } else { 'validated-tree' } }
                default {
                    if ($global:ClosureTestScenario -eq 'baseline') { '0000000000000000000000000000000000000000' }
                    elseif (($a[1] -eq 'HEAD' -and $global:ClosureTestCommitted) -or ($a[1] -eq 'refs/remotes/origin/main' -and $global:ClosureTestPushed)) { $global:ClosureTestCommit }
                    else { $baseline }
                }
            }
        }
        'symbolic-ref' { if ($global:ClosureTestScenario -eq 'branch') { 'other' } else { 'main' } }
        'rev-list' {
            if ($a -contains '--parents') { "$global:ClosureTestCommit $baseline" }
            elseif ($global:ClosureTestScenario -eq 'ahead' -or ($global:ClosureTestCommitted -and !$global:ClosureTestPushed)) { "1`t0" }
            else { "0`t0" }
        }
        'ls-remote' {
            if ($global:ClosureTestScenario -eq 'remote' -or ($global:ClosureTestPushed -and $global:ClosureTestScenario -eq 'post-remote')) { "0000000000000000000000000000000000000000`trefs/heads/main" }
            elseif ($global:ClosureTestPushed) { "$global:ClosureTestCommit`trefs/heads/main" }
            else { "$baseline`trefs/heads/main" }
        }
        'ls-files' {
            if ($a -contains '--others') {
                $raw="$protected$([char]0)"
                if (!$global:ClosureTestStaged -and !$global:ClosureTestCommitted) { $raw+="approved.txt$([char]0)" }
                $raw
            } elseif ($global:ClosureTestScenario -eq 'protected-tracked') { "$protected$([char]0)" }
        }
        'status' {
            if ($a -contains '-z') {
                $raw="?? $protected$([char]0)"
                if (!$global:ClosureTestCommitted) {
                    if ($global:ClosureTestStaged) { $raw+="A  approved.txt$([char]0)" } else { $raw+="?? approved.txt$([char]0)" }
                }
                $raw
            } else { "?? $protected" }
        }
        'diff' {
            if ($a -contains '--check') { if ($global:ClosureTestScenario -eq 'whitespace' -or ($global:ClosureTestStaged -and $global:ClosureTestScenario -eq 'cached-check')) { $global:LASTEXITCODE = 2; 'whitespace error' } }
            elseif ($a -contains '--cached') { if ($global:ClosureTestScenario -eq 'staged' -or $global:ClosureTestStaged) { "approved.txt$([char]0)" } }
            elseif ($global:ClosureTestScenario -eq 'outside') { "unexpected.txt$([char]0)" }
            elseif ($global:ClosureTestScenario -in @('stderr-warning','stderr-failure')) {
                Write-Error "warning: in the working copy of 'approved.txt', LF will be replaced by CRLF the next time Git touches it"
                "approved.txt$([char]0)"
                if ($global:ClosureTestScenario -eq 'stderr-failure') { $global:LASTEXITCODE = 1 }
            }
            elseif ($global:ClosureTestScenario -like 'control-*') {
                $control = @{ 'control-tab'=9; 'control-lf'=10; 'control-cr'=13; 'control-del'=127 }[$global:ClosureTestScenario]
                "bad$([char]$control)path.txt$([char]0)"
            }
        }
        'add' { if ($a[2] -cne ':(literal)approved.txt') { throw 'Non-literal staging.' }; if ($global:ClosureTestScenario -eq 'add-fail') { $global:LASTEXITCODE=1 } else { $global:ClosureTestStaged=$true } }
        'write-tree' { 'validated-tree' }
        'commit' { if ($global:ClosureTestScenario -eq 'commit-fail') { $global:LASTEXITCODE=1 } else { $global:ClosureTestCommitted=$true; $global:ClosureTestStaged=$false } }
        'diff-tree' { "approved.txt$([char]0)" }
        'push' { if ($global:ClosureTestScenario -eq 'push-fail') { $global:LASTEXITCODE=1 } else { $global:ClosureTestPushed=$true } }
        default { throw "Unexpected command reached: $($a -join ' ')" }
    }
}
try {
    $global:ClosureTestStaged=$false; $global:ClosureTestCommitted=$false; $global:ClosureTestPushed=$false
    $global:ClosureTestCommit='1111111111111111111111111111111111111111'
    $tokens = $null; $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($tool,[ref]$tokens,[ref]$parseErrors)
    if ($parseErrors.Count) { throw ($parseErrors -join "`n") }
    $passed = 0
    foreach ($scenario in @('valid','baseline','branch','ahead','remote','protected-tracked','whitespace','staged','outside','traversal','directory','protected-approved','duplicate','stderr-warning','stderr-failure','control-tab','control-lf','control-cr','control-del','approved-nul')) {
        $global:ClosureTestScenario = $scenario; $global:ClosureTestCalls = @()
        $files = @('approved.txt')
        switch ($scenario) {
            'traversal' { $files = @('../approved.txt') }
            'directory' { $files = @('docs') }
            'protected-approved' { $files = @($protected) }
            'duplicate' { $files = @('approved.txt','APPROVED.txt') }
            'approved-nul' { $files = @("bad$([char]0)path.txt") }
        }
        $shouldPass = $scenario -in @('valid','stderr-warning')
        $failed = $false
        try { $result = @(& $tool -RepositoryPath $repo -ExpectedBaseline $baseline -ApprovedFiles $files -CommitMessage 'test validation') }
        catch {
            $failed = $true
            if ($shouldPass) { Write-Output $_ }
            if ($scenario -like 'control-*' -and $_.Exception.Message -notmatch 'Control characters') { throw 'Wrong control-character rejection.' }
            if ($scenario -eq 'stderr-failure' -and $_.Exception.Message -notmatch 'git diff failed:.*warning:') { throw 'Nonzero exit lost stderr diagnostics.' }
        }
        if ($shouldPass -eq $failed) { throw "Unexpected outcome: $scenario" }
        if (@($global:ClosureTestCalls | Where-Object { $_ -match '^(add|commit|push|write-tree|fetch|reset|clean|restore) ' }).Count) { throw 'Mutation attempted.' }
        if ($shouldPass -and ($result -join "`n") -notmatch 'VALIDATED / NOT STAGED') { throw 'Missing validation result.' }
        $passed++
        Write-Output "PASS $scenario"
    }
    foreach ($scenario in @('execute-valid','add-fail','cached-check','commit-fail','tree-change','push-fail','post-remote')) {
        $global:ClosureTestScenario=$scenario; $global:ClosureTestCalls=@()
        $global:ClosureTestStaged=$false; $global:ClosureTestCommitted=$false; $global:ClosureTestPushed=$false
        $failed=$false
        try { $result=@(& $tool -RepositoryPath $repo -ExpectedBaseline $baseline -ApprovedFiles @('approved.txt') -CommitMessage 'mock closure' -Execute) } catch { $failed=$true; if ($scenario -eq 'execute-valid') { Write-Output $_ } }
        if (($scenario -eq 'execute-valid') -eq $failed) { throw "Unexpected execution outcome: $scenario" }
        if ($scenario -in @('add-fail','cached-check','commit-fail','tree-change') -and @($global:ClosureTestCalls | Where-Object { $_ -match '^push ' }).Count) { throw 'Push reached after failed gate.' }
        if ($scenario -eq 'execute-valid' -and ($result -join "`n") -notmatch 'COMMITTED / PUSHED / VERIFIED') { throw 'Missing closure result.' }
        $passed++; Write-Output "PASS mocked $scenario"
    }
    Write-Output "$passed safety tests passed; all closure Git operations were mocked."
} finally { Remove-Item Function:\git }

# Load only the parser/runner functions, never the tool's closure body.
$ast = [System.Management.Automation.Language.Parser]::ParseFile($tool,[ref]$tokens,[ref]$parseErrors)
foreach ($name in @('Invoke-ClosureGit','Names')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false)
    . ([scriptblock]::Create($definition.Extent.Text))
}
function global:git {
    $global:LASTEXITCODE = 0
    Write-Error 'warning: synthetic stderr must not enter the NUL-delimited path stream'
    $global:ClosureParserPayload
}
try {
    $normal = @('app/[locale]/layout.tsx','tests/korean-font.test.mjs',
        'app/fonts/gowun-batang/GowunBatang-Regular.woff2',
        'app/fonts/gowun-batang/GowunBatang-Bold.woff2','scripts/optimize-gowun-batang.mjs',
        'space in name.txt','literal"quote.txt',('unicode-' + [char]0xD55C + '.txt'))
    $global:ClosureParserPayload = ($normal -join [char]0) + [char]0
    $parsed = @(Names @('diff','--name-only','-z'))
    if ($parsed.Count -ne $normal.Count -or @(Compare-Object $parsed $normal -CaseSensitive).Count) { throw 'Normal paths or NUL protocol delimiters were altered.' }
    Write-Output 'PASS normal paths: brackets, spaces, quotes, Unicode, all five Gowun paths and NUL delimiters'
    foreach ($code in @(1..31) + @(127)) {
        $global:ClosureParserPayload = "bad$([char]$code)path.txt$([char]0)"
        $rejected = $false
        try { $null = @(Names @('diff','--name-only','-z')) }
        catch { if ($_.Exception.Message -notmatch 'Control characters') { throw }; $rejected = $true }
        if (!$rejected) { throw "Control character $code was accepted." }
    }
    Write-Output 'PASS all 32 non-NUL ASCII control characters rejected; embedded approved NUL rejected above'
} finally { Remove-Item Function:\git }

# Native Git read-only smoke: actual stderr warnings must not become path data.
Push-Location -LiteralPath $repo
try {
    foreach ($arguments in @(
        ,@('diff','--name-only','--no-renames','-z')
        ,@('diff','--cached','--name-only','--no-renames','-z')
        ,@('ls-files','--others','--exclude-standard','-z')
    )) { $null = @(Names $arguments) }
    Write-Output 'PASS native Git path parsing (read-only diff/cached diff/ls-files)'
} finally { Pop-Location }
