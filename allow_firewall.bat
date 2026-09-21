@echo off
chcp 65001 >nul
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Administrator huquqi so‘ralmoqda...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo  Windows Brandmauerida (Firewall) 3000-port ochilmoqda...
echo ============================================================
netsh advfirewall firewall delete rule name="SER_Tizim_Port_3000" >nul 2>&1
netsh advfirewall firewall add rule name="SER_Tizim_Port_3000" dir=in action=allow protocol=TCP localport=3000 profile=any
powershell -Command "Set-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' -Profile Any" 2>nul
echo.
echo [MUVAFFAQIYATLI] 3000-port va Node.js barcha tarmoqlar (Private va Public) uchun ochildi!
echo.
echo Endi telefoningiz brauzerida quyidagi manzilni oching:
echo   http://192.168.1.60:3000
echo   http://192.168.1.60:3000/admin
echo.
pause
