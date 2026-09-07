<#
.SYNOPSIS
    Points the API at the local Docker database, using the password in .env.

.DESCRIPTION
    Reads MSSQL_SA_PASSWORD from server/.env - the same value docker-compose
    gives the container - and writes the matching connection string to user
    secrets. The password never appears on a command line or in a shell
    history, which is the point of doing it here rather than by hand.

    Also generates a JWT signing key if one is not already set. It leaves an
    existing key alone: regenerating it invalidates every refresh token, which
    is nothing in development and is still not something a setup script should
    do behind your back.

    Run it AS A FILE, not by pasting it into a prompt. Pasted line by line,
    `throw` prints and execution carries on to the next line.

.EXAMPLE
    pwsh -File .\scripts\set-local-secrets.ps1
#>
[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot '..' '.env'),
    [string]$ProjectPath = (Join-Path $PSScriptRoot '..' 'MusicTheory.API'),
    [string]$Database = 'MusicTheoryDb'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) {
    throw @"
No .env at $EnvFile.

    cd server
    cp .env.example .env      # then put a password in it
    docker compose up -d
"@
}

$settings = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $settings[$Matches[1]] = $Matches[2].Trim()
    }
}

$password = $settings['MSSQL_SA_PASSWORD']
if ([string]::IsNullOrWhiteSpace($password)) {
    throw "MSSQL_SA_PASSWORD is empty in $EnvFile. Set it, and make sure the container was started with the same value."
}

$port = if ($settings['MSSQL_HOST_PORT']) { $settings['MSSQL_HOST_PORT'] } else { '1433' }

Push-Location $ProjectPath
try {
    dotnet user-secrets set 'ConnectionStrings:DefaultConnection' `
        "Server=localhost,$port;Database=$Database;User Id=sa;Password=$password;TrustServerCertificate=True" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Writing the connection string to user secrets failed.' }

    # Only if absent. See the description.
    $existing = dotnet user-secrets list 2>$null
    if (-not ($existing -match '^Jwt:Key\s*=')) {
        $bytes = [byte[]]::new(48)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $key = [Convert]::ToBase64String($bytes)

        dotnet user-secrets set 'Jwt:Key' $key | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Writing the JWT key to user secrets failed.' }

        Write-Host 'Generated a JWT signing key.'
    }
    else {
        Write-Host 'Jwt:Key already set, left alone.'
    }
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host "Connection string points at localhost,$port." -ForegroundColor Green
Write-Host 'Check with: dotnet user-secrets list --project MusicTheory.API'
