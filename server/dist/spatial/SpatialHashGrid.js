"use strict";
/**
 * SpatialHashGrid.ts
 * Sistema de Partición Espacial (Spatial Partitioning) para MMO Top-Down Battle Royale.
 *
 * Divide el mundo masivo (4800x4800) en una grilla uniforme de celdas (ej. 500x500px).
 * Permite inserción, actualización, eliminación y consultas por radio en O(1) celdas promedio,
 * reduciendo la complejidad de detección de colisiones autoritativas de O(N^2) a O(1) vecinos.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpatialHashGrid = void 0;
class SpatialHashGrid {
    constructor(cellSize = 500, worldWidth = 4800, worldHeight = 4800) {
        /** Celdas de la grilla mapeadas por clave "col:row" -> Conjunto de entidades */
        this.cells = new Map();
        /** Registro rápido de entidad -> lista de claves de celdas donde está registrada */
        this.entityToCells = new Map();
        this.cellSize = cellSize;
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
        this.cols = Math.ceil(worldWidth / cellSize);
        this.rows = Math.ceil(worldHeight / cellSize);
    }
    /**
     * Genera la clave de identificación única para una celda
     */
    getCellKey(col, row) {
        return `${col}:${row}`;
    }
    /**
     * Calcula el rango de celdas que abarca una entidad según su círculo delimitador
     */
    getCellSpan(x, y, radius) {
        const minCol = Math.max(0, Math.min(this.cols - 1, Math.floor((x - radius) / this.cellSize)));
        const maxCol = Math.max(0, Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize)));
        const minRow = Math.max(0, Math.min(this.rows - 1, Math.floor((y - radius) / this.cellSize)));
        const maxRow = Math.max(0, Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize)));
        return { minCol, maxCol, minRow, maxRow };
    }
    /**
     * Inserta una entidad en las celdas correspondientes de la grilla
     */
    insert(entity) {
        if (!entity || !entity.id)
            return;
        // Si ya existía, removerla primero para evitar duplicados
        if (this.entityToCells.has(entity.id)) {
            this.remove(entity.id);
        }
        const { minCol, maxCol, minRow, maxRow } = this.getCellSpan(entity.x, entity.y, entity.radius);
        const cellKeys = [];
        for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
                const key = this.getCellKey(c, r);
                let cell = this.cells.get(key);
                if (!cell) {
                    cell = new Set();
                    this.cells.set(key, cell);
                }
                cell.add(entity);
                cellKeys.push(key);
            }
        }
        this.entityToCells.set(entity.id, { entity, cellKeys });
    }
    /**
     * Actualiza la posición de una entidad en la grilla.
     * Optimización: Si las celdas ocupadas no cambiaron, solo actualiza las coordenadas sin churn de Set.
     */
    update(entity) {
        if (!entity || !entity.id)
            return;
        const record = this.entityToCells.get(entity.id);
        if (!record) {
            this.insert(entity);
            return;
        }
        const { minCol, maxCol, minRow, maxRow } = this.getCellSpan(entity.x, entity.y, entity.radius);
        // Calcular las nuevas claves
        const newKeys = [];
        for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
                newKeys.push(this.getCellKey(c, r));
            }
        }
        // Verificar si las celdas siguen siendo idénticas
        const oldKeys = record.cellKeys;
        let sameCells = oldKeys.length === newKeys.length;
        if (sameCells) {
            for (let i = 0; i < oldKeys.length; i++) {
                if (oldKeys[i] !== newKeys[i]) {
                    sameCells = false;
                    break;
                }
            }
        }
        // Si sigue en las mismas celdas, mantener registro y salir (Cero overhead de memoria)
        if (sameCells) {
            record.entity.x = entity.x;
            record.entity.y = entity.y;
            record.entity.radius = entity.radius;
            record.entity.data = entity.data;
            return;
        }
        // Si cambió de celdas, remover de las viejas e insertar en las nuevas
        for (const key of oldKeys) {
            const cell = this.cells.get(key);
            if (cell) {
                cell.delete(record.entity);
                if (cell.size === 0) {
                    this.cells.delete(key);
                }
            }
        }
        for (const key of newKeys) {
            let cell = this.cells.get(key);
            if (!cell) {
                cell = new Set();
                this.cells.set(key, cell);
            }
            cell.add(entity);
        }
        record.entity = entity;
        record.cellKeys = newKeys;
    }
    /**
     * Remueve una entidad de la grilla por su ID
     */
    remove(id) {
        const record = this.entityToCells.get(id);
        if (!record)
            return;
        for (const key of record.cellKeys) {
            const cell = this.cells.get(key);
            if (cell) {
                cell.delete(record.entity);
                if (cell.size === 0) {
                    this.cells.delete(key);
                }
            }
        }
        this.entityToCells.delete(id);
    }
    /**
     * Obtiene una entidad por su ID
     */
    get(id) {
        return this.entityToCells.get(id)?.entity;
    }
    /**
     * Consulta espacial por radio (Circle Query):
     * Encuentra todas las entidades que intersecan el círculo (x, y, radius).
     * Solo evalúa las celdas cubiertas por el AABB del círculo y sus vecinos adyacentes.
     */
    queryRadius(x, y, radius, filterTypes) {
        const { minCol, maxCol, minRow, maxRow } = this.getCellSpan(x, y, radius);
        const results = [];
        const visitedIds = new Set();
        const radiusSq = radius * radius;
        for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
                const key = this.getCellKey(c, r);
                const cell = this.cells.get(key);
                if (!cell)
                    continue;
                for (const entity of cell) {
                    if (visitedIds.has(entity.id))
                        continue;
                    visitedIds.add(entity.id);
                    if (filterTypes && !filterTypes.includes(entity.type)) {
                        continue;
                    }
                    // Test de intersección de círculos (radio consulta + radio entidad)
                    const totalRadius = radius + entity.radius;
                    const dx = entity.x - x;
                    const dy = entity.y - y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq <= totalRadius * totalRadius) {
                        results.push(entity);
                    }
                }
            }
        }
        return results;
    }
    /**
     * Retorna todas las entidades que se encuentran en la misma celda de (x, y) o celdas adyacentes (3x3 celdas)
     */
    queryNearbyCells(x, y, filterTypes) {
        const centerCol = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
        const centerRow = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
        const minCol = Math.max(0, centerCol - 1);
        const maxCol = Math.min(this.cols - 1, centerCol + 1);
        const minRow = Math.max(0, centerRow - 1);
        const maxRow = Math.min(this.rows - 1, centerRow + 1);
        const results = [];
        const visitedIds = new Set();
        for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
                const key = this.getCellKey(c, r);
                const cell = this.cells.get(key);
                if (!cell)
                    continue;
                for (const entity of cell) {
                    if (visitedIds.has(entity.id))
                        continue;
                    visitedIds.add(entity.id);
                    if (filterTypes && !filterTypes.includes(entity.type)) {
                        continue;
                    }
                    results.push(entity);
                }
            }
        }
        return results;
    }
    /**
     * Limpia toda la grilla
     */
    clear() {
        this.cells.clear();
        this.entityToCells.clear();
    }
    /**
     * Estadísticas de telemetría para monitoreo de rendimiento
     */
    getStats() {
        return {
            totalEntities: this.entityToCells.size,
            activeCells: this.cells.size,
        };
    }
}
exports.SpatialHashGrid = SpatialHashGrid;
