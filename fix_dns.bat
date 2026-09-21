@echo off
chcp 65001 > nul
echo =======================================================
echo  Wi-Fi uchun Google DNS (8.8.8.8 va 1.1.1.1) o'rnatish
echo =======================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [DIQQAT] Ushbu faylni sichqonchaning o'ng tugmasini bosib,
    echo "Administrator nomidan ishga tushirish" (Run as administrator) qiling!
    echo.
    pause
    exit /b 1
)

echo Wi-Fi adapteri sozlanmoqda...
netsh interface ipv4 set dns name="Wi-Fi" static 8.8.8.8 primary
netsh interface ipv4 add dns name="Wi-Fi" 1.1.1.1 index=2
ipconfig /flushdns

echo.
echo [MUVAFFAQIYAT] DNS muvaffaqiyatli 8.8.8.8 ga o'rnatildi!
echo Endi GitHub va boshqa barcha saytlar tez va to'siqlarsiz ishlaydi.
echo.
pause
