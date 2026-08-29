@echo off
echo Stopping and removing old containers...
docker compose down --remove-orphans

echo Removing old images to force clean rebuild...
docker rmi portal-frontend portal-backend 2>nul
docker rmi fieldops-frontend fieldops-backend 2>nul

echo Building and starting fresh...
docker compose up --build -d

echo.
echo Waiting 15 seconds for containers to start...
timeout /t 15 /nobreak

echo.
echo Container status:
docker ps

echo.
echo Backend health check:
curl -s http://localhost/health

echo.
echo Done! Open http://localhost in your browser.
