/**
 * SpatialHashGrid.ts
 * Sistema de Partición Espacial (Spatial Partitioning) para MMO Top-Down Battle Royale.
 * 
 * Divide el mundo masivo (4800x4800) en una grilla uniforme de celdas (ej. 500x500px).
 * Permite inserción, actualización, eliminación y consultas por radio en O(1) celdas promedio,
 * reduciendo la complejidad de detección de colisiones autoritativas de O(N^2) a O(1) vecinos.
 */

export interface SpatialEntity {
  id: string;
  x: number;
  y: number;
  radius: number;
  type: "player" | "projectile" | "trap" | "obstacle" | "item";
  data?: any;
}

export class SpatialHashGrid {
  public readonly cellSize: number;
  public readonly worldWidth: number;
  public readonly worldHeight: number;
  public readonly cols: number;
  public readonly rows: number;

  /** Celdas de la grilla mapeadas por clave "col:row" -> Conjunto de entidades */
  private cells: Map<string, Set<SpatialEntity>> = new Map();

  /** Registro rápido de entidad -> lista de claves de celdas donde está registrada */
  private entityToCells: Map<string, { entity: SpatialEntity; cellKeys: string[] }> = new Map();

  constructor(cellSize = 500, worldWidth = 4800, worldHeight = 4800) {
    this.cellSize = cellSize;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
  }

  /**
   * Genera la clave de identificación única para una celda
   */
  private getCellKey(col: number, row: number): string {
    return `${col}:${row}`;
  }

  /**
   * Calcula el rango de celdas que abarca una entidad según su círculo delimitador
   */
  private getCellSpan(x: number, y: number, radius: number): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    const minCol = Math.max(0, Math.min(this.cols - 1, Math.floor((x - radius) / this.cellSize)));
    const maxCol = Math.max(0, Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize)));
    const minRow = Math.max(0, Math.min(this.rows - 1, Math.floor((y - radius) / this.cellSize)));
    const maxRow = Math.max(0, Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize)));
    return { minCol, maxCol, minRow, maxRow };
  }

  /**
   * Inserta una entidad en las celdas correspondientes de la grilla
   */
  public insert(entity: SpatialEntity): void {
    if (!entity || !entity.id) return;

    // Si ya existía, removerla primero para evitar duplicados
    if (this.entityToCells.has(entity.id)) {
      this.remove(entity.id);
    }

    const { minCol, maxCol, minRow, maxRow } = this.getCellSpan(entity.x, entity.y, entity.radius);
    const cellKeys: string[] = [];

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = this.getCellKey(c, r);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Set<SpatialEntity>();
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
  public update(entity: SpatialEntity): void {
    if (!entity || !entity.id) return;

    const record = this.entityToCells.get(entity.id);
    if (!record) {
      this.insert(entity);
      return;
    }

    const { minCol, maxCol, minRow, maxRow } = this.getCellSpan(entity.x, entity.y, entity.radius);

    // Calcular las nuevas claves
    const newKeys: string[] = [];
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
        cell = new Set<SpatialEntity>();
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
  public remove(id: string): void {
    const record = this.entityToCells.get(id);
    if (!record) return;

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
  public get(id: string): SpatialEntity | undefined {
    return this.entityToCells.get(id)?.entity;
  }

  /**
   * Consulta espacial por radio (Circle Query):
   * Encuentra todas las entidades que intersecan el círculo (x, y, radius).
   * Solo evalúa las celdas cubiertas por el AABB del círculo y sus vecinos adyacentes.
   */
  public queryRadius(
    x: number,
    y: number,
    radius: number,
    filterTypes?: Array<"player" | "projectile" | "trap" | "obstacle" | "item">
  ): SpatialEntity[] {
    const { minCol, maxCol, minRow, maxRow } = this.getCellSpan(x, y, radius);
    const results: SpatialEntity[] = [];
    const visitedIds = new Set<string>();
    const radiusSq = radius * radius;

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = this.getCellKey(c, r);
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const entity of cell) {
          if (visitedIds.has(entity.id)) continue;
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
  public queryNearbyCells(
    x: number,
    y: number,
    filterTypes?: Array<"player" | "projectile" | "trap" | "obstacle" | "item">
  ): SpatialEntity[] {
    const centerCol = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    const centerRow = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));

    const minCol = Math.max(0, centerCol - 1);
    const maxCol = Math.min(this.cols - 1, centerCol + 1);
    const minRow = Math.max(0, centerRow - 1);
    const maxRow = Math.min(this.rows - 1, centerRow + 1);

    const results: SpatialEntity[] = [];
    const visitedIds = new Set<string>();

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = this.getCellKey(c, r);
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const entity of cell) {
          if (visitedIds.has(entity.id)) continue;
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
  public clear(): void {
    this.cells.clear();
    this.entityToCells.clear();
  }

  /**
   * Estadísticas de telemetría para monitoreo de rendimiento
   */
  public getStats(): { totalEntities: number; activeCells: number } {
    return {
      totalEntities: this.entityToCells.size,
      activeCells: this.cells.size,
    };
  }
}
