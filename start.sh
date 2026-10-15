#!/usr/bin/env bash

# Obtener la ruta del directorio del script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "=========================================="
echo " Iniciando Servidor y Cliente del Juego"
echo "=========================================="
echo ""

# Limpiar puertos que puedan estar en uso de sesiones anteriores
echo "🧹 Liberando puertos anteriores..."
fuser -k 2567/tcp 3000/tcp 2>/dev/null
pkill -f ts-node-dev 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

# Función para detener los procesos al presionar Ctrl+C
cleanup() {
    echo ""
    echo "Deteniendo servidor y cliente..."
    kill $(jobs -p) 2>/dev/null
    fuser -k 2567/tcp 3000/tcp 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "[1/2] Arrancando Servidor (Colyseus) en puerto 2567..."
(cd "$DIR/server" && npm run dev) &

echo "[2/2] Arrancando Cliente (Vite) en puerto 3000..."
(cd "$DIR/client" && npm run dev -- --host) &

echo ""
echo "=========================================="
echo " Servidor y Cliente ejecutándose."
echo " Presiona Ctrl+C para detener ambos."
echo "=========================================="
echo ""

wait
