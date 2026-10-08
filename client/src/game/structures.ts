export interface Doorway {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StructureDef {
  id: string;
  name: string;
  type: "MANSION" | "BUNKER" | "WAREHOUSE" | "LAB" | "OUTPOST" | "CABIN";
  x: number;
  y: number;
  width: number;
  height: number;
  roofColor: number;
  roofTrimColor: number;
  floorColor: number;
  doorways: Doorway[];
}

export const STRUCTURES: StructureDef[] = [
  // 1. Centro Táctico / Mansión Felina (Centro)
  {
    id: "mansion_center",
    name: "Mansión Felina Central",
    type: "MANSION",
    x: 4000,
    y: 3400,
    width: 680,
    height: 520,
    roofColor: 0x1e293b,
    roofTrimColor: 0x38bdf8,
    floorColor: 0x451a03,
    doorways: [
      { x: 4000, y: 3140, width: 90, height: 26 }, // Entrada Norte
      { x: 4000, y: 3660, width: 90, height: 26 }, // Entrada Sur
      { x: 4340, y: 3400, width: 26, height: 90 }, // Entrada Este
    ]
  },
  // 2. Búnker Militar Subterráneo (Noroeste)
  {
    id: "bunker_nw",
    name: "Búnker Militar Blindado",
    type: "BUNKER",
    x: 2000,
    y: 2000,
    width: 540,
    height: 440,
    roofColor: 0x334155,
    roofTrimColor: 0xf59e0b,
    floorColor: 0x1e293b,
    doorways: [
      { x: 2000, y: 2220, width: 80, height: 26 }  // Entrada Sur
    ]
  },
  // 3. Almacén Industrial de Contenedores (Sureste)
  {
    id: "warehouse_se",
    name: "Almacén de Contenedores",
    type: "WAREHOUSE",
    x: 6000,
    y: 6000,
    width: 620,
    height: 480,
    roofColor: 0x7f1d1d,
    roofTrimColor: 0xef4444,
    floorColor: 0x374151,
    doorways: [
      { x: 5690, y: 6000, width: 26, height: 90 }, // Portón Oeste
      { x: 6000, y: 5760, width: 90, height: 26 }, // Portón Norte
    ]
  },
  // 4. Laboratorio Bio-Químico (Noreste)
  {
    id: "lab_ne",
    name: "Laboratorio Bio-Químico",
    type: "LAB",
    x: 6000,
    y: 2000,
    width: 540,
    height: 420,
    roofColor: 0x0f766e,
    roofTrimColor: 0x2dd4bf,
    floorColor: 0x134e4a,
    doorways: [
      { x: 6000, y: 2210, width: 80, height: 26 }  // Entrada Sur
    ]
  },
  // 5. Fuerte Táctico de la Selva (Suroeste)
  {
    id: "fort_sw",
    name: "Fuerte Táctico de la Selva",
    type: "OUTPOST",
    x: 2000,
    y: 6000,
    width: 500,
    height: 460,
    roofColor: 0x78350f,
    roofTrimColor: 0xd97706,
    floorColor: 0x713f12,
    doorways: [
      { x: 2250, y: 6000, width: 26, height: 90 }  // Portón Este
    ]
  },
  // 6. Cabaña de Exploradores Norte
  {
    id: "cabin_n",
    name: "Cabaña del Bosque Norte",
    type: "CABIN",
    x: 4000,
    y: 1400,
    width: 340,
    height: 260,
    roofColor: 0x854d0e,
    roofTrimColor: 0xb45309,
    floorColor: 0x78350f,
    doorways: [
      { x: 4000, y: 1530, width: 70, height: 24 }
    ]
  },
  // 7. Cabaña de Exploradores Sur
  {
    id: "cabin_s",
    name: "Cabaña de la Ribera Sur",
    type: "CABIN",
    x: 4000,
    y: 6600,
    width: 340,
    height: 260,
    roofColor: 0x854d0e,
    roofTrimColor: 0xb45309,
    floorColor: 0x78350f,
    doorways: [
      { x: 4000, y: 6470, width: 70, height: 24 }
    ]
  },
  // 8. Cabaña de Exploradores Oeste
  {
    id: "cabin_w",
    name: "Cabaña de la Colina Oeste",
    type: "CABIN",
    x: 1400,
    y: 4000,
    width: 340,
    height: 260,
    roofColor: 0x854d0e,
    roofTrimColor: 0xb45309,
    floorColor: 0x78350f,
    doorways: [
      { x: 1570, y: 4000, width: 24, height: 70 }
    ]
  },
  // 9. Cabaña de Exploradores Este
  {
    id: "cabin_e",
    name: "Cabaña Costera Este",
    type: "CABIN",
    x: 6600,
    y: 4000,
    width: 340,
    height: 260,
    roofColor: 0x854d0e,
    roofTrimColor: 0xb45309,
    floorColor: 0x78350f,
    doorways: [
      { x: 6430, y: 4000, width: 24, height: 70 }
    ]
  }
];
