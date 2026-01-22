# Kill existing processes on ports
fuser -k 3001/tcp 2>/dev/null
fuser -k 8081/tcp 2>/dev/null

echo "🚀 Starting Big D's Tree Service System..."
# ... (lines skipped)
# 2. Start Frontend
echo "🌐 Starting Frontend (Port 8081)..."
cd ..
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
