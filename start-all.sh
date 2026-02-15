#!/bin/bash
# Kill existing processes on ports
fuser -k 3001/tcp 2>/dev/null
fuser -k 8081/tcp 2>/dev/null

echo "🚀 Starting Big D's Tree Service System..."

# 1. Start Backend
echo "⚙️ Starting Backend (Port 3001)..."
cd backend
# Check if node_modules exists, install if not (safety check)
if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install
fi
nohup npm run dev > server.log 2>&1 &
BACKEND_PID=$!
echo "   Backend running (PID: $BACKEND_PID)"
cd ..

# 2. Start Frontend
echo "🌐 Starting Frontend (Port 8081)..."
# Serve current directory where index.html resides
nohup python3 -m http.server 8081 > frontend-8081.log 2>&1 &
FRONTEND_PID=$!
echo "   Frontend running (PID: $FRONTEND_PID)"

echo "------------------------------------------------"
echo "✅ System Online!"
echo "   Frontend: http://localhost:8081"
echo "   Backend:  http://localhost:3001"
echo "------------------------------------------------"
echo "Logs:"
echo "   Backend:  tail -f backend/server.log"
echo "   Frontend: tail -f frontend-8081.log"
