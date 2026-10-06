import { Client, Room } from "colyseus.js";

// No singleton — instancia nueva cada vez para evitar sockets zombies con HMR
export class NetworkClient {
  private client: Client;
  public room: Room | null = null;
  public sessionId: string = "";

  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const hostname = window.location.hostname || "localhost";
    const serverUrl = `${protocol}//${hostname}:2567`;
    console.log(`📡 NetworkClient apuntando a: ${serverUrl}`);
    this.client = new Client(serverUrl);
  }

  public async connect(): Promise<Room> {
    this.room = await this.client.joinOrCreate("jungle_room");
    this.sessionId = this.room.sessionId;
    console.log(`✅ Sala conectada. SessionId: ${this.sessionId}`);
    return this.room;
  }

  public disconnect() {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
  }

  public sendMove(dx: number, dy: number, rotation: number) {
    this.room?.send("move", { dx, dy, rotation });
  }

  public sendDash() {
    this.room?.send("dash");
  }

  public sendShoot(angle: number) {
    this.room?.send("shoot", { angle });
  }

  public sendPlaceTrap(x: number, y: number) {
    this.room?.send("placeTrap", { x, y });
  }
}
