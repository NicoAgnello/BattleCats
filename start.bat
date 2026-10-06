@echo off
title Launcher - Juego Battle Royale
echo ==========================================
echo  Iniciando Servidor y Cliente del Juego
echo ==========================================
echo.

echo Launching Server (Colyseus)...
start "Servidor Colyseus" cmd /k "cd /d %~dp0server && npm run dev"

echo Launching Client (Vite)...
start "Cliente Vite" cmd /k "cd /d %~dp0client && npm run dev"

echo.
echo ==========================================
echo  Servidor y Cliente iniciados en ventanas separadas.
echo ==========================================
echo.
pause
