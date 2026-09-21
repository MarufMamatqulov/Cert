@echo off
chcp 65001 >nul
echo ============================================================
echo  Windows Brandmauerida (Firewall) 3000-port ochilmoqda...
echo ============================================================
netsh advfirewall firewall add rule name="SER_Tizim_Port_3000" dir=in action=allow protocol=TCP localport=3000 profile=any
powershell -Command "Set-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' -Profile Any" 2>nul
echo.
echo [MUVAFFAQIYATLI] 3000-port va Node.js barcha tarmoqlar uchun ochildi!
echo Endi boshqa qurilmalardan: http://192.168.1.60:3000 manziliga kirishingiz mumkin.
echo.
pause
