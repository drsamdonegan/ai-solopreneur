$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$testRoot = Join-Path $env:RUNNER_TEMP "ai-solo-native-dependencies"

if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $testRoot | Out-Null

$env:AI_SOLO_RUNTIME_DIR = Join-Path $testRoot "runtime"
$env:AI_SOLO_FORCE_PORTABLE_NODE = "1"
$env:NODE_ENV = "production"
$env:NPM_CONFIG_OMIT = "dev optional"
$env:NPM_CONFIG_IGNORE_SCRIPTS = "true"
$env:NPM_CONFIG_BIN_LINKS = "false"
$env:NPM_CONFIG_CACHE = Join-Path $testRoot "npm-cache"

@'
{
  "name": "ai-solo-windows-native-smoke",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "isolated-vm": "6.1.2",
    "sqlite3": "5.1.7"
  },
  "allowScripts": {
    "isolated-vm@6.1.2": true,
    "sqlite3@5.1.7": true
  }
}
'@ | Set-Content -LiteralPath (Join-Path $testRoot "package.json") -Encoding UTF8

try {
    . (Join-Path $projectRoot "scripts\windows\NodeRuntime.ps1")
    $nodePath = Resolve-ProjectNode -ProjectRoot $projectRoot -Install
    $nodeDirectory = Split-Path -Parent $nodePath
    $env:Path = "$nodeDirectory;$env:Path"
    $npmCli = Join-Path $nodeDirectory "node_modules\npm\bin\npm-cli.js"

    if ((& $nodePath --version) -ne "v24.18.0") {
        throw "The focused smoke did not select Node.js 24.18.0."
    }
    if ((& $nodePath -p "process.arch") -ne "x64") {
        throw "The focused smoke did not select the Windows x64 compatibility runtime."
    }
    if ((& $nodePath $npmCli --version) -ne "11.16.0") {
        throw "The focused smoke did not select npm 11.16.0."
    }

    Push-Location $testRoot
    try {
        & $nodePath $npmCli install `
            --no-audit `
            --no-fund `
            --include=optional `
            --ignore-scripts=false `
            --bin-links=true `
            --strict-allow-scripts
        if ($LASTEXITCODE -ne 0) {
            throw "The focused native dependency install failed."
        }

        & $nodePath -e "require('sqlite3'); require('isolated-vm')"
        if ($LASTEXITCODE -ne 0) {
            throw "The reviewed Windows native dependencies did not load."
        }
    } finally {
        Pop-Location
    }

    Write-Host "Windows x64 native dependencies passed on this host."
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
