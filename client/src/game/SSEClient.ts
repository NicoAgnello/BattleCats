import { SERVER_HTTP } from "./serverUrl";

export interface SSETelemetry {
  connected: boolean;
  tickRate: number;
  ping: number;
  clientsConnected: number;
  memoryMb: number;
  lastUpdate: number;
}

export class SSEManager {
  private es: EventSource | null = null;
  public telemetry: SSETelemetry = {
    connected: false,
    tickRate: 60,
    ping: 0,
    clientsConnected: 1,
    memoryMb: 0,
    lastUpdate: 0,
  };

  private reconnectTimer: any = null;
  /** Sala a la que está suscripto el stream (los eventos de juego son por sala). */
  private roomId = "";

  constructor() {
    this.connect();
  }

  public connect() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }

    const query = this.roomId ? `?roomId=${encodeURIComponent(this.roomId)}` : "";
    const url = `${SERVER_HTTP}/api/events${query}`;

    try {
      this.es = new EventSource(url);

      this.es.onopen = () => {
        this.telemetry.connected = true;
        this.notifyTelemetry();
      };

      this.es.addEventListener("init", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.telemetry.connected = true;
          this.telemetry.tickRate = data.serverTickRate || 60;
          this.notifyTelemetry();
        } catch {}
      });

      this.es.addEventListener("telemetry", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const now = Date.now();
          const latency = Math.max(1, now - (data.timestamp || now));
          this.telemetry = {
            connected: true,
            tickRate: data.tickRate || 60,
            ping: latency,
            clientsConnected: data.clientsConnected || 1,
            memoryMb: data.memoryMb || 0,
            lastUpdate: now,
          };
          this.notifyTelemetry();
        } catch {}
      });

      this.es.addEventListener("kill", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-kill", { detail: data }));
        } catch {}
      });

      this.es.addEventListener("tick", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-tick", { detail: data }));
        } catch {}
      });

      this.es.addEventListener("playerShoot", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-shoot", { detail: data }));
        } catch {}
      });

      this.es.addEventListener("playerMelee", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-melee", { detail: data }));
        } catch {}
      });

      this.es.addEventListener("hit", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-hit", { detail: data }));
        } catch {}
      });

      this.es.addEventListener("playerDash", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-dash", { detail: data }));
        } catch {}
      });

      this.es.addEventListener("explosion", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("sse-explosion", { detail: data }));
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

  /** Cambia la sala suscripta (vacío = solo telemetría) y reabre el stream. */
  public setRoom(roomId: string) {
    if (roomId === this.roomId) return;
    this.roomId = roomId;
    clearTimeout(this.reconnectTimer);
    this.connect();
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
