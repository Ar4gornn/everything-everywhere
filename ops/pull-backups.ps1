# Off-box copy of the production backups: pulls every dump this machine does not have yet
# from the server into a local folder, checks each one's size against the server's, and
# keeps the newest $Keep. Meant for a Windows scheduled task (see ops/README or LOG.md);
# runs on Windows PowerShell 5.1, no extra modules.
#
# The dumps hold every account's data unencrypted. The destination is the operator's own
# disk; do not point it at a synced folder (OneDrive, Dropbox).
param(
    [string]$Dest = "C:\dev\backups\ee",
    [string]$HostName = "everything-everywhere.app",
    # The server's key is pinned under its IP in known_hosts; the alias checks that pin
    # rather than trusting a new key for the name.
    [string]$HostKeyAlias = "46.224.16.73",
    [string]$User = "alex",
    [string]$Key = "$env:USERPROFILE\.ssh\ee_vps",
    [string]$RemoteDir = "/srv/everything-everywhere/backups",
    [int]$Keep = 60
)

$ErrorActionPreference = "Stop"
$ssh = "C:\Windows\System32\OpenSSH\ssh.exe"
$scp = "C:\Windows\System32\OpenSSH\scp.exe"
$opts = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "HostKeyAlias=$HostKeyAlias", "-i", $Key)

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$log = Join-Path $Dest "pull.log"
function Log([string]$msg) {
    $line = "{0:u} {1}" -f (Get-Date).ToUniversalTime(), $msg
    Add-Content -Path $log -Value $line -Encoding UTF8
    Write-Output $line
}

try {
    # "name size" per dump, newest last.
    $listing = & $ssh @opts "$User@$HostName" "cd $RemoteDir && stat -c '%n %s' *.dump"
    if ($LASTEXITCODE -ne 0) { throw "listing failed (ssh exit $LASTEXITCODE)" }

    $pulled = 0
    foreach ($row in $listing) {
        $name, $size = $row -split " "
        if ($name -notmatch '^[A-Za-z0-9_]+-\d{8}-\d{6}Z\.dump$') { throw "unexpected name: $name" }
        $local = Join-Path $Dest $name
        if ((Test-Path $local) -and (Get-Item $local).Length -eq [long]$size) { continue }

        $partial = "$local.partial"
        & $scp @opts -q "${User}@${HostName}:$RemoteDir/$name" $partial
        if ($LASTEXITCODE -ne 0) { throw "scp $name failed (exit $LASTEXITCODE)" }
        $got = (Get-Item $partial).Length
        if ($got -ne [long]$size) { Remove-Item $partial; throw "$name size $got, server says $size" }
        Move-Item -Force $partial $local
        $pulled++
    }

    $dumps = Get-ChildItem -Path $Dest -Filter "*.dump" | Sort-Object Name
    $pruned = 0
    if ($dumps.Count -gt $Keep) {
        $dumps | Select-Object -First ($dumps.Count - $Keep) | ForEach-Object { Remove-Item $_.FullName; $pruned++ }
    }
    $newest = (Get-ChildItem -Path $Dest -Filter "*.dump" | Sort-Object Name | Select-Object -Last 1).Name
    Log "ok pulled=$pulled pruned=$pruned held=$([Math]::Min($dumps.Count, $Keep)) newest=$newest"
    exit 0
}
catch {
    Log "FAILED $($_.Exception.Message)"
    exit 1
}
