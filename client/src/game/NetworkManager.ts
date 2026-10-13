import { Client, Room } from "colyseus.js";
import { GameState } from "./schema/GameState";
import { SERVER_WS } from "./serverUrl";

/** El servidor rechaza crear una sala con un código en uso (JungleRoom.ROOM_CODE_TAKEN). */
const ROOM_CODE_TAKEN = 4409;
const randomRoomCode = () => String(Math.floor(1000 + Math.random() * 9000));

export interface ConnectOptions {
  name?: string;
  skin?: number;
  isCustom?: boolean;
  roomCode?: string;
  isHost?: boolean;
}

// No singleton — instancia nueva cada vez para evitar sockets zombies con HMR
export class NetworkClient {
  private client: Client;
  public room: Room<GameState> | null = null;
  public sessionId: string = "";

  constructor() {
    console.log(`📡 NetworkClient apuntando a: ${SERVER_WS}`);
    this.client = new Client(SERVER_WS);
  }

  public async connect(options: ConnectOptions = {}): Promise<Room<GameState>> {
    if (options.isCustom) {
      if (options.isHost) {
        // Si el código ya lo usa otra sala, se prueba con otro (el lobby muestra el
        // código real, que viene en el estado de la sala)
        for (let attempt = 0; ; attempt++) {
          console.log(`👑 Creando sala personalizada con código: ${options.roomCode}`);
          try {
            this.room = await this.client.create<GameState>("custom_room", options, GameState);
            break;
          } catch (e: any) {
            if (e?.code !== ROOM_CODE_TAKEN || attempt >= 5) throw e;
            options = { ...options, roomCode: randomRoomCode() };
          }
        }
      } else {
        console.log(`🐾 Uniéndose a sala personalizada con código: ${options.roomCode}`);
        this.room = await this.client.join<GameState>("custom_room", options, GameState);
      }
    } else {
      this.room = await this.client.joinOrCreate<GameState>("jungle_room", options, GameState);
    }
    this.sessionId = this.room.sessionId;
    console.log(`✅ Sala conectada. SessionId: ${this.sessionId}`, options);
    return this.room;
  }

  public disconnect() {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
  }

  public sendMove(dx: number, dy: number, rotation: number, x?: number, y?: number) {
    this.room?.send("move", { dx, dy, rotation, x, y });
  }


  public sendDash(dirX?: number, dirY?: number) {
    this.room?.send("dash", { dirX, dirY });
  }

  public sendShoot(angle: number, targetX?: number, targetY?: number, angles?: number[]) {
    this.room?.send("shoot", { angle, targetX, targetY, angles });
  }

  public sendReload() {
    this.room?.send("reload");
  }

  public sendPlaceTrap(x: number, y: number) {
    this.room?.send("placeTrap", { x, y });
  }

  public sendSwitchWeapon(weapon: string) {
    this.room?.send("switchWeapon", { weapon });
  }

  public sendEmote(emote: string) {
    this.room?.send("emote", { emote });
  }

  public sendInteract(itemId?: string) {
    this.room?.send("interact", { itemId });
  }

  public sendRestart() {
    this.room?.send("restart");
  }

  public sendStartMatch() {
    this.room?.send("startMatch");
  }
}


