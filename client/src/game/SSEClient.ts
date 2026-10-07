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

  constructor() {
    this.connect();
  }

  public connect() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }

    const hostname = window.location.hostname || "localhost";
    const port = 2567;
    const url = `http://${hostname}:${port}/api/events`;

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
