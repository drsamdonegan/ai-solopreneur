$ErrorActionPreference = "Stop"

function Get-ProjectNodePlatform {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) {
        $env:PROCESSOR_ARCHITEW6432
    } else {
        $env:PROCESSOR_ARCHITECTURE
    }

    switch ($architecture.ToUpperInvariant()) {
        "ARM64" { return "arm64" }
        "AMD64" { return "x64" }
        default { throw "Automatic Node.js setup does not support this processor: $architecture" }
    }
}

function Get-SystemNode24 {
    $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $command) {
        return $null
    }

    try {
        $major = & $command.Source -p 'Number(process.versions.node.split(".")[0])'
        if ([int]$major -ge 24) {
            return $command.Source
        }
    } catch {
        return $null
    }

    return $null
}

function Get-ExpectedNodeChecksum {
    param([Parameter(Mandatory = $true)][string]$Architecture)

    switch ($Architecture) {
        "arm64" { return "f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01" }
        "x64" { return "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821" }
        default { throw "No Node.js checksum is recorded for Windows $Architecture." }
    }
}

function Resolve-ProjectNode {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [switch]$Install
    )

    $forcePortable = $env:AI_SOLO_FORCE_PORTABLE_NODE -eq "1"
    if (-not $forcePortable) {
        $systemNode = Get-SystemNode24
        if ($systemNode) {
            return $systemNode
        }
    }

    $version = (Get-Content -LiteralPath (Join-Path $ProjectRoot ".node-version") -Raw).Trim()
    if ($version -notmatch '^\d+\.\d+\.\d+$') {
        throw "The pinned Node.js version in .node-version is invalid: $version"
    }

    $architecture = Get-ProjectNodePlatform
    $runtimeRoot = if ($env:AI_SOLO_RUNTIME_DIR) {
        $env:AI_SOLO_RUNTIME_DIR
    } else {
        Join-Path $ProjectRoot ".runtime"
    }
    $runtimeRoot = [IO.Path]::GetFullPath($runtimeRoot)
    $archiveBaseName = "node-v$version-win-$architecture"
    $installDirectory = Join-Path $runtimeRoot $archiveBaseName
    $portableNode = Join-Path $installDirectory "node.exe"

    if (Test-Path -LiteralPath $portableNode -PathType Leaf) {
        return $portableNode
    }
    if (-not $Install) {
        throw "Node.js 24+ is not available yet. Run setup-windows.cmd first."
    }

    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $temporaryDirectory = Join-Path $runtimeRoot ("node-download." + [IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

    try {
        $archiveName = "$archiveBaseName.zip"
        $archivePath = Join-Path $temporaryDirectory $archiveName
        $downloadUrl = "https://nodejs.org/dist/v$version/$archiveName"

        Write-Host "Node.js 24+ was not found. Downloading a private project copy of Node.js $version..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing

        $expectedChecksum = Get-ExpectedNodeChecksum -Architecture $architecture
        $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualChecksum -ne $expectedChecksum) {
            throw "The Node.js download failed its SHA-256 safety check. Expected $expectedChecksum, found $actualChecksum."
        }

        Write-Host "Verified the official Node.js download. Unpacking it inside this project..."
        Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryDirectory -Force
        $extractedDirectory = Join-Path $temporaryDirectory $archiveBaseName
        $extractedNode = Join-Path $extractedDirectory "node.exe"
        if (-not (Test-Path -LiteralPath $extractedNode -PathType Leaf)) {
            throw "The Node.js archive did not contain the expected executable."
        }

        if (-not (Test-Path -LiteralPath $installDirectory)) {
            Move-Item -LiteralPath $extractedDirectory -Destination $installDirectory
        }

        $installedVersion = & $portableNode --version
        if ($installedVersion -ne "v$version") {
            throw "The project-local Node.js version is unexpected: $installedVersion"
        }

        Write-Host "Project-local Node.js $version is ready. Nothing was installed globally."
        return $portableNode
    } finally {
        if (
            (Test-Path -LiteralPath $temporaryDirectory) -and
            $temporaryDirectory.StartsWith(
                [IO.Path]::GetFullPath($runtimeRoot) + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            [IO.Directory]::Delete($temporaryDirectory, $true)
        }
    }
}

function Invoke-ProjectLocalRunner {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$Command,
        [object[]]$CommandArguments = @()
    )

    $nodePath = Resolve-ProjectNode -ProjectRoot $ProjectRoot -Install
    $nodeDirectory = Split-Path -Parent $nodePath
    $env:Path = "$nodeDirectory;$env:Path"

    & $nodePath (Join-Path $ProjectRoot "scripts\local.mjs") $Command @CommandArguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "The local runner command '$Command' failed with exit code $exitCode."
    }
}
