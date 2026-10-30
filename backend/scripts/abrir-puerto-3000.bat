@echo off
title Abrir puerto 3000 - Asistencia Inteligente
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
netsh advfirewall firewall delete rule name="AttendanceSystem-Port-3000" >nul 2>&1
netsh advfirewall firewall delete rule name="AttendanceSystem-Port-3443" >nul 2>&1
netsh advfirewall firewall add rule name="AttendanceSystem-Port-3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="AttendanceSystem-Port-3443" dir=in action=allow protocol=TCP localport=3443
echo.
echo [OK] Puertos 3000 (http) y 3443 (https) abiertos.
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R /C:"IPv4 Address" /C:"Dirección IPv4"') do (
    for /f "tokens=1" %%B in ("%%A") do echo Link telefono (HTTPS, camara+GPS): https://%%B:3443
)
echo.
pause
