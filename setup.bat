@echo off
REM ═══════════════════════════════════════════════════════════════════════════════
REM ALTERA PostgreSQL Setup & Start Script for Windows
REM This script sets up PostgreSQL and starts the application
REM ═══════════════════════════════════════════════════════════════════════════════

cls

echo.
echo ╔════════════════════════════════════════════════════════════════════════════╗
echo ║                    ALTERA PostgreSQL Setup Script                          ║
echo ╚════════════════════════════════════════════════════════════════════════════╝
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
  echo ❌ Docker is not installed. Please install Docker Desktop first.
  pause
  exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
  echo ❌ Docker Compose is not installed. Please install Docker Desktop first.
  pause
  exit /b 1
)

echo ✅ Docker and Docker Compose are installed
echo.

echo 🔧 Starting ALTERA services with Docker Compose...
echo.

REM Start services
docker-compose up -d

if %errorlevel% equ 0 (
  echo.
  echo ✅ Services started successfully!
  echo.
  echo 📋 Services status:
  docker-compose ps
  echo.
  echo 🌐 API is running at: http://localhost:3000
  echo 🗄️  PostgreSQL is running at: localhost:5432
  echo 📊 Redis is running at: localhost:6379
  echo.
  echo 💡 Useful commands:
  echo    • View logs:           docker-compose logs -f api
  echo    • Connect to database: docker exec -it altera_postgres psql -U postgres -d altera_db
  echo    • Stop services:       docker-compose down
  echo    • Reset database:      docker-compose down -v ^&^& docker-compose up -d
  echo.
  pause
) else (
  echo.
  echo ❌ Failed to start services
  echo.
  docker-compose logs
  pause
  exit /b 1
)
