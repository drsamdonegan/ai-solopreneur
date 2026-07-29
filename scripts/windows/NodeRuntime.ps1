$ErrorActionPreference = "Stop"

function Get-WindowsProcessorArchitecture {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) {
        $env:PROCESSOR_ARCHITEW6432
    } else {
        $env:PROCESSOR_ARCHITECTURE
    }

    switch ($architecture.ToUpperInvariant()) {
        "ARM64" { return "ARM64" }
        "AMD64" { return "AMD64" }
        default { throw "Automatic Node.js setup does not support this processor: $architecture" }
    }
}

function Get-ProjectNodePlatform {
    $processor = Get-WindowsProcessorArchitecture
    if ($processor -eq "ARM64") {
        $windowsBuild = [Environment]::OSVersion.Version.Build
        if ($windowsBuild -lt 22000) {
            throw "ARM-based Windows laptops need Windows 11 for the x64 compatibility runtime used by this project. This computer reports Windows build $windowsBuild."
        }

        # n8n 2.30.5 includes native modules with Windows x64 prebuilds but no
        # Windows ARM64 prebuilds. Windows 11 runs this reviewed x64 runtime
        # through its built-in emulation layer, avoiding Visual Studio builds.
        return "x64"
    }

    return "x64"
}

function Test-ProjectNodeCompatibility {
    param(
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$Architecture,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion
    )

    return $Version -eq $ExpectedVersion -and $Architecture -eq "x64"
}

function Get-SystemNode24 {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedNpmVersion
    )

    $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $command) {
        return $null
    }

    try {
        $detailsJson = & $command.Source -p 'JSON.stringify({version:process.versions.node,arch:process.arch})'
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        $details = $detailsJson | ConvertFrom-Json
        if (-not (Test-ProjectNodeCompatibility `
            -Version $details.version `
            -Architecture $details.arch `
            -ExpectedVersion $ExpectedVersion)) {
            return $null
        }

        $npmCli = Join-Path (Split-Path -Parent $command.Source) "node_modules\npm\bin\npm-cli.js"
        if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
            return $null
        }
        $npmVersion = & $command.Source $npmCli --version
        if ($LASTEXITCODE -eq 0 -and $npmVersion -eq $ExpectedNpmVersion) {
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
        "x64" { return "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821" }
        default { throw "No Node.js checksum is recorded for Windows $Architecture." }
    }
}

function Test-PortableNodeRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedNpmVersion
    )

    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
        return $false
    }

    try {
        $detailsJson = & $NodePath -p 'JSON.stringify({version:process.versions.node,arch:process.arch})'
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        $details = $detailsJson | ConvertFrom-Json
        if (-not (Test-ProjectNodeCompatibility `
            -Version $details.version `
            -Architecture $details.arch `
            -ExpectedVersion $ExpectedVersion)) {
            return $false
        }

        $npmCli = Join-Path (Split-Path -Parent $NodePath) "node_modules\npm\bin\npm-cli.js"
        if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
            return $false
        }
        $installedNpmVersion = & $NodePath $npmCli --version
        return $LASTEXITCODE -eq 0 -and $installedNpmVersion -eq $ExpectedNpmVersion
    } catch {
        return $false
    }
}

function Resolve-ProjectNode {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [switch]$Install
    )

    $version = (Get-Content -LiteralPath (Join-Path $ProjectRoot ".node-version") -Raw).Trim()
    if ($version -notmatch '^\d+\.\d+\.\d+$') {
        throw "The pinned Node.js version in .node-version is invalid: $version"
    }
    $npmVersion = (Get-Content -LiteralPath (Join-Path $ProjectRoot ".npm-version") -Raw).Trim()
    if ($npmVersion -notmatch '^\d+\.\d+\.\d+$') {
        throw "The pinned npm version in .npm-version is invalid: $npmVersion"
    }

    # Validate the host before selecting any system or private runtime. Windows
    # 10 on ARM cannot run the reviewed x64 native-module path reliably.
    $architecture = Get-ProjectNodePlatform
    $forcePortable = $env:AI_SOLO_FORCE_PORTABLE_NODE -eq "1"
    if (-not $forcePortable) {
        $systemNode = Get-SystemNode24 `
            -ExpectedVersion $version `
            -ExpectedNpmVersion $npmVersion
        if ($systemNode) {
            return $systemNode
        }
    }

    $runtimeRoot = if ($env:AI_SOLO_RUNTIME_DIR) {
        $env:AI_SOLO_RUNTIME_DIR
    } else {
        Join-Path $ProjectRoot ".runtime"
    }
    $runtimeRoot = [IO.Path]::GetFullPath($runtimeRoot)
    $archiveBaseName = "node-v$version-win-$architecture"
    $installDirectory = Join-Path $runtimeRoot $archiveBaseName
    $portableNode = Join-Path $installDirectory "node.exe"

    if (Test-PortableNodeRuntime `
        -NodePath $portableNode `
        -ExpectedVersion $version `
        -ExpectedNpmVersion $npmVersion) {
        return $portableNode
    }
    if (-not $Install) {
        throw "The reviewed Node.js $version/npm $npmVersion runtime is not available or is incomplete. Run setup-windows.cmd to install or repair it."
    }

    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    if (Test-Path -LiteralPath $installDirectory) {
        Write-Warning "The private Node.js runtime is incomplete. Setup will replace that project-local folder."
        Remove-Item -LiteralPath $installDirectory -Recurse -Force
    }
    $temporaryDirectory = Join-Path $runtimeRoot ("node-download." + [IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

    try {
        $archiveName = "$archiveBaseName.zip"
        $archivePath = Join-Path $temporaryDirectory $archiveName
        $downloadUrl = "https://nodejs.org/dist/v$version/$archiveName"

        Write-Host "The reviewed Node.js runtime was not found. Downloading a private x64 copy of Node.js $version..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $downloaded = $false
        for ($attempt = 1; $attempt -le 3; $attempt += 1) {
            try {
                Invoke-WebRequest `
                    -Uri $downloadUrl `
                    -OutFile $archivePath `
                    -UseBasicParsing `
                    -TimeoutSec 120
                $downloaded = $true
                break
            } catch {
                Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
                if ($attempt -eq 3) {
                    throw "Could not download Node.js from $downloadUrl after three attempts. Check whether nodejs.org is allowed by this computer or network. Last error: $($_.Exception.Message)"
                }
                Write-Warning "Node.js download attempt $attempt failed. Retrying..."
                Start-Sleep -Seconds (2 * $attempt)
            }
        }
        if (-not $downloaded) {
            throw "The Node.js download did not complete."
        }

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

        if (Test-Path -LiteralPath $installDirectory) {
            Remove-Item -LiteralPath $installDirectory -Recurse -Force
        }
        Move-Item -LiteralPath $extractedDirectory -Destination $installDirectory

        if (-not (Test-PortableNodeRuntime `
            -NodePath $portableNode `
            -ExpectedVersion $version `
            -ExpectedNpmVersion $npmVersion)) {
            throw "The downloaded private Node.js/npm runtime did not match the reviewed versions and architecture."
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
            try {
                [IO.Directory]::Delete($temporaryDirectory, $true)
            } catch {
                Write-Warning "Windows could not remove the temporary Node.js download folder yet. It is safe to remove later: $temporaryDirectory"
            }
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
