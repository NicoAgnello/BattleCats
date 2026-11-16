import { SERVER_HTTP } from "./serverUrl";

export interface SSETelemetry {
  connected: boolean;
  /** Ciclos de simulación por segundo de la sala propia, medidos en el servidor (null = sin dato). */
  tickRate: number | null;
  /** Envíos de estado por segundo de la sala propia (null = sin dato). */
  patchRate: number | null;
  ping: number;
  clientsConnected: number;
  memoryMb: number;
  lastUpdate: number;
}

export class SSEManager {
  private es: EventSource | null = null;
  public telemetry: SSETelemetry = {
    connected: false,
    tickRate: null,
    patchRate: null,
    ping: 0,
    clientsConnected: 0,
    memoryMb: 0,
    lastUpdate: 0,
  };

  private reconnectTimer: any = null;
  /** Sala del jugador: de la telemetría se toman los ritmos de esta sala. */
  private roomId = "";

  constructor() {
    this.connect();
  }

  public connect() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }

    // Solo telemetría del HUD: el estado y los eventos del juego van por el WebSocket
    const url = `${SERVER_HTTP}/api/events`;

    try {
      this.es = new EventSource(url);

      this.es.onopen = () => {
        this.telemetry.connected = true;
        this.notifyTelemetry();
      };

      this.es.addEventListener("init", (e: MessageEvent) => {
        try {
          JSON.parse(e.data);
          this.telemetry.connected = true;
          this.notifyTelemetry();
        } catch {}
      });

      this.es.addEventListener("telemetry", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const now = Date.now();
          // El ping no se calcula acá: restar la hora del servidor a la de esta PC solo
          // da la diferencia entre sus relojes. Lo mide NetworkManager (setPing).
          const mine = this.roomId ? data.rooms?.[this.roomId] : undefined;
          this.telemetry = {
            connected: true,
            tickRate: mine ? mine.tickRate : null,
            patchRate: mine ? mine.patchRate : null,
            ping: this.telemetry.ping,
            clientsConnected: data.clientsConnected ?? 0,
            memoryMb: data.memoryMb ?? 0,
            lastUpdate: now,
          };
          this.notifyTelemetry();
        } catch {}
      });

      this.es.onerror = () => {
        this.telemetry.connected = false;
        this.notifyTelemetry();
        if (this.es) {
          this.es.close();
          this.es = null;
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 2500);
      };
    } catch {
      this.telemetry.connected = false;
      this.notifyTelemetry();
    }
  }

  /** Sala actual del jugador (vacío al salir): elige qué ritmos mostrar. */
  public setRoom(roomId: string) {
    this.roomId = roomId;
    if (!roomId) {
      this.telemetry.tickRate = null;
      this.telemetry.patchRate = null;
      this.notifyTelemetry();
    }
  }

  /** Latencia medida con ping/pong por el WebSocket del juego (ida y vuelta, en ms). */
  public setPing(ms: number) {
    this.telemetry.ping = ms;
    this.notifyTelemetry();
  }

  private notifyTelemetry() {
    window.dispatchEvent(new CustomEvent("sse-telemetry", { detail: { ...this.telemetry } }));
  }

  public disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.telemetry.connected = false;
  }
}

export const sseManager = new SSEManager();
