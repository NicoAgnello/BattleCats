#!/usr/bin/env bash

# Obtener la ruta del directorio del script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "=========================================="
echo " Iniciando Servidor y Cliente del Juego"
echo "=========================================="
echo ""

# Función para detener los procesos al presionar Ctrl+C
cleanup() {
    echo ""
    echo "Deteniendo servidor y cliente..."
    kill $(jobs -p) 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "[1/2] Arrancando Servidor (Colyseus)..."
(cd "$DIR/server" && npm run dev) &

echo "[2/2] Arrancando Cliente (Vite)..."
(cd "$DIR/client" && npm run dev) &

echo ""
echo "=========================================="
echo " Servidor y Cliente ejecutándose."
echo " Presiona Ctrl+C para detener ambos."
echo "=========================================="
echo ""

wait
