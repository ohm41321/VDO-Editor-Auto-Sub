@echo off
TITLE VDO Editor Auto Sub - Full Stack
COLOR 0B

echo ==================================================
echo        VDO Editor Auto Sub - Starter
echo ==================================================
echo.

echo [1/3] Starting Backend (FastAPI)...
:: เปิดหน้าต่างใหม่ รัน Backend
start "Backend Server" cmd /k "cd backend && py main.py"

echo [2/3] Starting Frontend (Next.js)...
:: เปิดหน้าต่างใหม่ รัน Frontend
start "Frontend Dev" cmd /k "cd frontend && npm run dev"

echo [3/3] Opening Browser...
:: รอสักครู่เพื่อให้ Server เริ่มทำงานก่อนเปิด Browser
timeout /t 5 /nobreak > nul
start http://localhost:3000

echo.
echo --------------------------------------------------
echo  All processes are launching:
echo  - Backend is running on: http://localhost:8000
echo  - Frontend is running on: http://localhost:3000
echo  - Browser has been opened to Frontend.
echo --------------------------------------------------
echo.
echo Press any key to close this starter window...
pause > nul
