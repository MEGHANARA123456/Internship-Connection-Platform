$root = "D:\shortfundly app\Internship Connection Platform"
Set-Location "$root\backend"
& "$root\.venv\Scripts\Activate.ps1"

# 1. database + mail catcher up, Docker copy of the API stopped
docker start doc-db-1 doc-mailpit-1 | Out-Null
docker stop doc-backend-1 2>$null | Out-Null
do { Start-Sleep -Seconds 1; docker exec doc-db-1 pg_isready -U postgres -q } until ($LASTEXITCODE -eq 0)

# 2. free port 8010 if an old local backend is still running
Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -match 'python|uvicorn') { Stop-Process -Id $p.Id -Force }
}

# 3. local settings (.env uses the Docker name "db", which does not work from Windows)
$env:DATABASE_URL = "postgresql+asyncpg://postgres:postgres@localhost:55432/internship_platform"
$env:FRONTEND_URL = "http://localhost:5174"

# 4. frontend on port 5174 in its own window (skipped if it is already running)
if (-not (Test-NetConnection 127.0.0.1 -Port 5174 -WarningAction SilentlyContinue).TcpTestSucceeded) {
  $cmd = "Set-Location '$root\frontend'; if (!(Test-Path node_modules)) { npm install }; npm run dev -- --port 5174 --strictPort"
  Start-Process powershell -ArgumentList '-NoExit','-Command',$cmd
}

# 5. open the browser once both ports (8010 API, 5174 app) are listening
Start-Job -ScriptBlock {
  foreach ($i in 1..120) {
    $api = (Test-NetConnection 127.0.0.1 -Port 8010 -WarningAction SilentlyContinue).TcpTestSucceeded
    $web = (Test-NetConnection 127.0.0.1 -Port 5174 -WarningAction SilentlyContinue).TcpTestSucceeded
    if ($api -and $web) { Start-Process "http://localhost:5174"; break }
    Start-Sleep -Seconds 1
  }
} | Out-Null

# 6. migrate, then run the API in this window
alembic upgrade head
if ($LASTEXITCODE -ne 0) { Write-Host "Migration failed. Fix it before starting the API." -ForegroundColor Red; return }
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload --reload-dir app
