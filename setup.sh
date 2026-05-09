#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════════
# ALTERA PostgreSQL Setup & Start Script
# This script sets up PostgreSQL and starts the application
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                    ALTERA PostgreSQL Setup Script                          ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed. Please install Docker first."
  exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
  echo "❌ Docker Compose is not installed. Please install it first."
  exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Change to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Starting ALTERA services with Docker Compose..."
echo ""

# Start services
docker-compose up -d

if [ $? -eq 0 ]; then
  echo "✅ Services started successfully!"
  echo ""
  echo "📋 Services status:"
  docker-compose ps
  echo ""
  echo "🌐 API is running at: http://localhost:3000"
  echo "🗄️  PostgreSQL is running at: localhost:5432"
  echo "📊 Redis is running at: localhost:6379"
  echo ""
  echo "💡 Useful commands:"
  echo "   • View logs:           docker-compose logs -f api"
  echo "   • Connect to database: docker exec -it altera_postgres psql -U postgres -d altera_db"
  echo "   • Stop services:       docker-compose down"
  echo "   • Reset database:      docker-compose down -v && docker-compose up -d"
  echo ""
else
  echo "❌ Failed to start services"
  docker-compose logs
  exit 1
fi
