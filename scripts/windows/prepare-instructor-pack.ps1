param(
    [string]$OutputRoot,
    [switch]$MetadataOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "NodeRuntime.ps1")

function Resolve-GitExecutable {
    $command = Get-Command git -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    if ($env:LOCALAPPDATA) {
        $desktopRoot = Join-Path $env:LOCALAPPDATA "GitHubDesktop"
        if (Test-Path -LiteralPath $desktopRoot -PathType Container) {
            $candidate = Get-ChildItem -LiteralPath $desktopRoot -Directory -Filter "app-*" |
                Sort-Object LastWriteTime -Descending |
                ForEach-Object {
                    Join-Path $_.FullName "resources\app\git\cmd\git.exe"
                } |
                Where-Object {
                    Test-Path -LiteralPath $_ -PathType Leaf
                } |
                Select-Object -First 1
            if ($candidate) {
                return $candidate
            }
        }
    }

    throw "Git was not found. Install/open GitHub Desktop once, or install Git for Windows, then try again."
}

$version = (Get-Content (Join-Path $projectRoot "VERSION") -Raw).Trim()
$nodeVersion = (Get-Content (Join-Path $projectRoot ".node-version") -Raw).Trim()
$npmVersion = (Get-Content (Join-Path $projectRoot ".npm-version") -Raw).Trim()
$package = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$n8nVersion = $package.dependencies.n8n
$nodePath = Resolve-ProjectNode -ProjectRoot $projectRoot -Install
$env:Path = "$(Split-Path -Parent $nodePath);$env:Path"

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $projectRoot "instructor-pack"
}

if ($MetadataOnly) {
    $packKind = "metadata-test"
    $commit = "uncommitted-validation"
}
else {
    $gitPath = Resolve-GitExecutable
    $status = & $gitPath -C $projectRoot status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw "Git is required to create the versioned source archive."
    }
    if ($status) {
        throw "The Git worktree has uncommitted changes. Commit or discard them before creating a release kit."
    }
    $packKind = "source"
    $commit = (& $gitPath -C $projectRoot rev-parse HEAD).Trim()
}

$packDirectory = Join-Path $OutputRoot "v$version-$packKind"
if (Test-Path $packDirectory) {
    throw "Instructor pack already exists: $packDirectory. Move or remove that specific folder before trying again."
}

$workflowDirectory = Join-Path $packDirectory "workflows"
New-Item -ItemType Directory -Path $workflowDirectory -Force | Out-Null

& $nodePath (Join-Path $projectRoot "scripts\validate-release.mjs")
if ($LASTEXITCODE -ne 0) { throw "Release validation failed." }
& $nodePath (Join-Path $projectRoot "scripts\validate-workflows.mjs")
if ($LASTEXITCODE -ne 0) { throw "Workflow validation failed." }

Copy-Item (Join-Path $projectRoot "n8n\workflows\*.json") $workflowDirectory

@"
AI Solopreneur instructor kit
Version: $version
Commit: $commit
Node.js runtime: $nodeVersion
npm runtime: $npmVersion
n8n package: $n8nVersion
Generated UTC: $((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
"@ | Set-Content (Join-Path $packDirectory "RELEASE-METADATA.txt") -Encoding utf8

@"
# Start the workshop project

This kit contains AI Solopreneur **v$version**, the reviewed workflow exports,
and checksums for every included file.

For a full release kit:

1. Extract ``ai-solopreneur-v$version-source.zip``.
2. Open the extracted folder in Claude Code.
3. Ask Claude Code to run the setup helper for this project.
4. Open the local chat URL printed by setup.

The setup helper uses the reviewed Node.js $nodeVersion/npm $npmVersion pair
when it is already available. Otherwise it downloads a checksum-verified
private x64 runtime into the project. The first setup requires internet access
for the runtime/packages and real Claude messages require each learner's private
Anthropic API key.
"@ | Set-Content (Join-Path $packDirectory "START_HERE.md") -Encoding utf8

if (-not $MetadataOnly) {
    $sourceArchive = Join-Path $packDirectory "ai-solopreneur-v$version-source.zip"
    & $gitPath -C $projectRoot archive `
        --format=zip `
        "--prefix=ai-solopreneur-v$version/" `
        "--output=$sourceArchive" `
        HEAD
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Git source archive." }
}

$checksumFile = Join-Path $packDirectory "SHA256SUMS"
Get-ChildItem $packDirectory -Recurse -File |
    Where-Object { $_.FullName -ne $checksumFile } |
    Sort-Object FullName |
    ForEach-Object {
        $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $relative = $_.FullName.Substring($packDirectory.TrimEnd("\").Length + 1).Replace("\", "/")
        "$hash  $relative"
    } |
    Set-Content $checksumFile -Encoding ascii

Write-Host "`nInstructor kit created at:`n  $packDirectory" -ForegroundColor Green
if ($MetadataOnly) {
    Write-Host "Metadata-only mode did not save the Git source archive."
}
else {
    Write-Host "Keep the kit private until you have checked it and copied it securely."
}
