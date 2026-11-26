import { BUILDINGS, getBuildingFootprint } from '../data/buildings.data';
import type { ChunkManager } from '../core/ChunkManager';
import { BuildingInstance, TileFlag, UtilityFlag, WorldEngineState } from '../core/GameState';
import { CHUNK_SIZE, tileKey } from '../core/IsoMath';
import { getBuildingStatsAtLevel } from './BuildingSimulation';
import type { ClimateModifiers } from './EnvironmentSystem';

import { RoadType } from '../data/roads.data';

export type UtilityPlacementKind = 'power_line' | 'substation' | 'water_pipe' | 'water_pump';

const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const UTILITY_COSTS: Record<UtilityPlacementKind, number> = {
  power_line: 8,
  substation: 45,
  water_pipe: 8,
  water_pump: 45,
};

export interface UtilityNetworkSnapshot {
  powerTiles: Set<number>;
  waterTiles: Set<number>;
  powerTileNet: Map<number, number>;
  waterTileNet: Map<number, number>;
  powerOverloadedNets: Set<number>;
  waterOverloadedNets: Set<number>;
  substationCenters: Array<{ gx: number; gy: number }>;
  pumpCenters: Array<{ gx: number; gy: number }>;
}

/**
 * Two-stage utility evaluator:
 * 1) Physical Network Connectivity (BFS over PowerLine/PowerSubstation & WaterPipe/WaterPump
 *    plus roads and directly touching adjacent buildings).
 * 2) Per-Network Generation vs Distribution Capacity vs Demand Capacity.
 */
export class UtilityNetworkSystem {
  private static lastSnapshot: UtilityNetworkSnapshot | null = null;
  private static dirty = true;
  private static lastEvalSignature = '';
  private static evalVersion = 1;

  public static markDirty(): void {
    this.dirty = true;
  }

  public static getEvalVersion(): number {
    return this.evalVersion;
  }

  public static getLastSnapshot(): UtilityNetworkSnapshot | null {
    return this.lastSnapshot;
  }

  private static minDistToFootprint(
    px: number,
    py: number,
    gx: number,
    gy: number,
    width: number,
    height: number
  ): number {
    const dx = Math.max(0, Math.max(gx - px, px - (gx + width - 1)));
    const dy = Math.max(0, Math.max(gy - py, py - (gy + height - 1)));
    return dx + dy;
  }

  public static placeUtility(
    kind: UtilityPlacementKind,
    gx: number,
    gy: number,
    state: WorldEngineState,
    chunks: ChunkManager
  ): { ok: boolean; reason?: string } {
    if (!chunks.isUnlocked(gx, gy)) {
      return { ok: false, reason: 'Unlock tile before installing utilities' };
    }
    const cost = UTILITY_COSTS[kind];
    if (state.coins < cost) {
      return { ok: false, reason: `Needs ${cost} Coins` };
    }
    const flag =
      kind === 'power_line'
        ? UtilityFlag.PowerLine
        : kind === 'substation'
          ? UtilityFlag.PowerLine | UtilityFlag.PowerSubstation
          : kind === 'water_pipe'
            ? UtilityFlag.WaterPipe
            : UtilityFlag.WaterPipe | UtilityFlag.WaterPump;

    const existing = chunks.getTileUtility(gx, gy);
    if ((existing & flag) === flag) {
      return { ok: false, reason: 'Already installed on this tile' };
    }

    state.coins -= cost;
    chunks.setTileUtilityFlag(gx, gy, flag, true);
    this.dirty = true;
    return { ok: true };
  }

  public static removeUtility(
    kind: 'power' | 'water',
    gx: number,
    gy: number,
    state: WorldEngineState,
    chunks: ChunkManager
  ): { ok: boolean; reason?: string } {
    if (!chunks.isUnlocked(gx, gy)) {
      return { ok: false, reason: 'Tile is locked' };
    }
    const mask =
      kind === 'power'
        ? UtilityFlag.PowerLine | UtilityFlag.PowerSubstation
        : UtilityFlag.WaterPipe | UtilityFlag.WaterPump;
    const existing = chunks.getTileUtility(gx, gy);
    if ((existing & mask) === 0) {
      return { ok: false, reason: `No ${kind} utility on this tile` };
    }
    chunks.setTileUtilityFlag(gx, gy, mask, false);
    state.coins += 4;
    this.dirty = true;
    return { ok: true };
  }

  private static computeEvalSignature(state: WorldEngineState, climate: ClimateModifiers): string {
    let bldHash = state.buildings.length;
    for (let i = 0; i < state.buildings.length; i++) {
      const b = state.buildings[i];
      const constructing = b.status === 'constructing' ? 1 : 0;
      const enabled = b.enabled ? 2 : 0;
      bldHash = (Math.imul(bldHash, 31) + (b.id ^ (b.level << 10) ^ (b.assignedWorkers << 16) ^ constructing ^ enabled)) | 0;
    }
    const coalOk = state.resources.coal >= 1 ? 1 : 0;
    const ecoWater = state.activePolicies?.includes('eco_water_pact') ? 1 : 0;
    return `${bldHash}|${coalOk}|${ecoWater}|${climate.windPowerMult.toFixed(2)}|${climate.solarPowerMult.toFixed(2)}|${climate.waterDemandMult.toFixed(2)}`;
  }

  public static evaluateNetworks(
    state: WorldEngineState,
    chunks: ChunkManager,
    climate: ClimateModifiers,
    force = false
  ): void {
    const evalSig = this.computeEvalSignature(state, climate);
    if (!force && !this.dirty && this.lastSnapshot !== null && evalSig === this.lastEvalSignature) {
      return;
    }
    this.dirty = false;
    this.lastEvalSignature = evalSig;
    this.evalVersion += 1;

    // Index all non-constructing buildings onto a tile map so networks bridge across adjacent buildings
    const tileToBuilding = new Map<number, BuildingInstance[]>();
    for (let bi = 0; bi < state.buildings.length; bi++) {
      const b = state.buildings[bi];
      if (b.status === 'constructing') continue;
      const def = BUILDINGS[b.defId];
      if (!def) continue;
      const fp = getBuildingFootprint(def, b.rotation ?? 0);
      for (let dx = 0; dx < fp.width; dx++) {
        for (let dy = 0; dy < fp.height; dy++) {
          const k = tileKey(b.gx + dx, b.gy + dy);
          const list = tileToBuilding.get(k);
          if (list) list.push(b);
          else tileToBuilding.set(k, [b]);
        }
      }
    }

    // Collect utility and road conductor tiles from all loaded chunks
    const powerTiles = new Set<number>();
    const substationCenters: Array<{ gx: number; gy: number }> = [];
    const substationKeySet = new Set<number>();
    const waterTiles = new Set<number>();
    const pumpCenters: Array<{ gx: number; gy: number }> = [];
    const pumpKeySet = new Set<number>();

    for (const chunk of chunks.getAllLoadedChunks()) {
      const baseX = chunk.cx * CHUNK_SIZE;
      const baseY = chunk.cy * CHUNK_SIZE;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const gy = baseY + ly;
        const rowOff = ly * CHUNK_SIZE;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const i = rowOff + lx;
          if ((chunk.flags[i] & TileFlag.Unlocked) === 0) continue;
          const u = chunk.utilityNet[i];
          const rt = chunk.roadType[i] as RoadType;
          const isDrivableRoad = rt !== RoadType.None && rt !== RoadType.Rail;
          const hasPower = (u & (UtilityFlag.PowerLine | UtilityFlag.PowerSubstation)) !== 0 || isDrivableRoad;
          const hasWater = (u & (UtilityFlag.WaterPipe | UtilityFlag.WaterPump)) !== 0 || isDrivableRoad;

          if (!hasPower && !hasWater) continue;
          const gx = baseX + lx;
          const key = tileKey(gx, gy);
          if (hasPower) {
            powerTiles.add(key);
            if ((u & UtilityFlag.PowerSubstation) !== 0) {
              substationCenters.push({ gx, gy });
              substationKeySet.add(key);
            }
          }
          if (hasWater) {
            waterTiles.add(key);
            if ((u & UtilityFlag.WaterPump) !== 0) {
              pumpCenters.push({ gx, gy });
              pumpKeySet.add(key);
            }
          }
        }
      }
    }

    // --- 1. POWER NETWORK FLOOD FILL ---
    const powerTileNet = new Map<number, number>();
    const powerGenByNet = new Map<number, number>();
    const powerDemByNet = new Map<number, number>();
    const powerDistCapByNet = new Map<number, number>();
    const powerOverloadedNets = new Set<number>();
    const visitedPowerBuildings = new Set<number>();
    let nextPowerNetId = 1;

    // Seed from ALL non-constructing generators (even if disabled/inactive) so connected consumers know source status
    const allPowerSources = state.buildings.filter((b) => {
      if (b.status === 'constructing') return false;
      const def = BUILDINGS[b.defId];
      return Boolean(def?.powerOutput && def.powerOutput > 0);
    });

    const getEffectivePowerOutput = (b: BuildingInstance): number => {
      const def = BUILDINGS[b.defId];
      if (!def?.powerOutput || !b.enabled) return 0;
      if (def.minWorkers > 0 && b.assignedWorkers < def.minWorkers) return 0;
      let p = getBuildingStatsAtLevel(def, b.level).powerOutput;
      if (b.defId === 'wind_turbine') p *= climate.windPowerMult;
      if (b.defId === 'solar_array') p *= climate.solarPowerMult;
      if (b.defId === 'coal_power_plant' && state.resources.coal < 1) return 0;
      return Math.round(p);
    };

    const getScaledPowerDemand = (b: BuildingInstance): number => {
      const def = BUILDINGS[b.defId];
      if (!def?.powerDemand || !b.enabled) return 0;
      return getBuildingStatsAtLevel(def, b.level).powerDemand;
    };

    // Process enabled generators first so active grids claim shared networks before disabled generators
    const sortedPowerSources = [...allPowerSources].sort((a, b) => Number(b.enabled) - Number(a.enabled));

    for (const src of sortedPowerSources) {
      if (visitedPowerBuildings.has(src.id)) continue;
      const netId = nextPowerNetId++;
      let netGen = 0;
      let netDem = 0;
      let netTiles = 0;
      let netSubstations = 0;
      let netSources = 0;

      const queue: Array<{ gx: number; gy: number; key: number }> = [];
      const enqueuedTiles = new Set<number>();

      const addBuildingToPowerNet = (b: BuildingInstance) => {
        if (visitedPowerBuildings.has(b.id)) return;
        visitedPowerBuildings.add(b.id);
        b.powerConnected = true;
        b.powerNetworkId = netId;
        const def = BUILDINGS[b.defId];
        if (!def) return;
        if (def.powerOutput && def.powerOutput > 0 && b.enabled) netSources++;
        netGen += getEffectivePowerOutput(b);
        netDem += getScaledPowerDemand(b);

        const fp = getBuildingFootprint(def, b.rotation ?? 0);
        const aura = def.powerOutput && b.enabled ? 3 : 1;
        for (let dx = -aura; dx < fp.width + aura; dx++) {
          for (let dy = -aura; dy < fp.height + aura; dy++) {
            const tx = b.gx + dx;
            const ty = b.gy + dy;
            const tk = tileKey(tx, ty);
            if (enqueuedTiles.has(tk)) continue;
            const inFootprint = dx >= 0 && dx < fp.width && dy >= 0 && dy < fp.height;
            const orthoBorder =
              ((dx === -1 || dx === fp.width) && dy >= 0 && dy < fp.height) ||
              ((dy === -1 || dy === fp.height) && dx >= 0 && dx < fp.width);

            if (
              inFootprint ||
              (orthoBorder && (powerTiles.has(tk) || tileToBuilding.has(tk))) ||
              (def.powerOutput && b.enabled && (powerTiles.has(tk) || tileToBuilding.has(tk)))
            ) {
              enqueuedTiles.add(tk);
              queue.push({ gx: tx, gy: ty, key: tk });
            }
          }
        }
      };

      addBuildingToPowerNet(src);

      while (queue.length > 0) {
        const cur = queue.pop()!;
        const ck = cur.key;
        if (!powerTileNet.has(ck)) powerTileNet.set(ck, netId);
        if (powerTiles.has(ck)) {
          netTiles++;
          if (substationKeySet.has(ck)) netSubstations++;
        }

        const bList = tileToBuilding.get(ck);
        if (bList) {
          for (let bi = 0; bi < bList.length; bi++) addBuildingToPowerNet(bList[bi]);
        }

        if (powerTiles.has(ck)) {
          for (let d = 0; d < 4; d++) {
            const nx = cur.gx + DIRS[d][0];
            const ny = cur.gy + DIRS[d][1];
            const nk = tileKey(nx, ny);
            if (!enqueuedTiles.has(nk) && (powerTiles.has(nk) || tileToBuilding.has(nk))) {
              enqueuedTiles.add(nk);
              queue.push({ gx: nx, gy: ny, key: nk });
            }
          }
          if (substationKeySet.has(ck)) {
            for (let rx = -5; rx <= 5; rx++) {
              for (let ry = -5; ry <= 5; ry++) {
                if (Math.abs(rx) + Math.abs(ry) > 5) continue;
                const sk = tileKey(cur.gx + rx, cur.gy + ry);
                const sBldgs = tileToBuilding.get(sk);
                if (sBldgs) {
                  for (let bi = 0; bi < sBldgs.length; bi++) addBuildingToPowerNet(sBldgs[bi]);
                }
              }
            }
          }
        }
      }

      powerGenByNet.set(netId, netGen);
      powerDemByNet.set(netId, netDem);
      const distCap = Math.max(180, netSources * 180 + netTiles * 22 + netSubstations * 240);
      powerDistCapByNet.set(netId, distCap);
      if (netGen > distCap && netDem > distCap) {
        powerOverloadedNets.add(netId);
      }
    }

    const hasAnyPowerLineNeighbor = (b: BuildingInstance): boolean => {
      const def = BUILDINGS[b.defId];
      if (!def) return false;
      const fp = getBuildingFootprint(def, b.rotation ?? 0);
      for (let dx = -1; dx <= fp.width; dx++) {
        for (let dy = -1; dy <= fp.height; dy++) {
          const isInsideOrOrtho =
            (dx >= 0 && dx < fp.width && dy >= 0 && dy < fp.height) ||
            ((dx === -1 || dx === fp.width) && dy >= 0 && dy < fp.height) ||
            ((dy === -1 || dy === fp.height) && dx >= 0 && dx < fp.width);
          if (!isInsideOrOrtho) continue;
          if (powerTiles.has(tileKey(b.gx + dx, b.gy + dy))) return true;
        }
      }
      return substationCenters.some(
        (s) => this.minDistToFootprint(s.gx, s.gy, b.gx, b.gy, fp.width, fp.height) <= 5
      );
    };

    let totalPowerGen = 0;
    let totalPowerDistCap = 0;
    let totalPowerDelivered = 0;
    let totalPowerDem = 0;
    let pConn = 0;
    let pDisc = 0;
    let pBrownout = 0;

    for (const src of allPowerSources) totalPowerGen += getEffectivePowerOutput(src);
    for (const cap of powerDistCapByNet.values()) totalPowerDistCap += cap;

    for (let bi = 0; bi < state.buildings.length; bi++) {
      const b = state.buildings[bi];
      if (b.status === 'constructing') continue;
      const dem = getScaledPowerDemand(b);
      if (!b.enabled) {
        b.powerConnected = visitedPowerBuildings.has(b.id);
        b.powerSatisfaction = dem > 0 ? 0 : 1;
        b.powerReason = 'ok';
        continue;
      }

      if (!visitedPowerBuildings.has(b.id)) {
        b.powerConnected = false;
        b.powerNetworkId = 0;
        b.powerSatisfaction = dem > 0 ? 0 : 1;
        b.powerReason =
          dem > 0
            ? hasAnyPowerLineNeighbor(b)
              ? 'disconnected_section_no_source'
              : 'not_connected_to_network'
            : 'ok';
        if (dem > 0) {
          totalPowerDem += dem;
          pDisc++;
        }
      } else {
        const netId = b.powerNetworkId ?? 0;
        const g = powerGenByNet.get(netId) ?? 0;
        const d = powerDemByNet.get(netId) ?? 0;
        const distCap = powerDistCapByNet.get(netId) ?? 999999;
        const effectiveCap = Math.min(g, distCap);
        const sat = d === 0 ? 1 : g <= 0 ? 0 : Math.min(1, effectiveCap / d);
        b.powerSatisfaction = sat;
        if (dem > 0) {
          totalPowerDem += dem;
          totalPowerDelivered += Math.round(dem * sat);
          pConn++;
          if (sat < 1) pBrownout++;
        }
        if (sat >= 1 || dem === 0) {
          b.powerReason = 'ok';
        } else if (g <= 0) {
          b.powerReason = 'source_inactive';
        } else if (g > distCap && d > distCap) {
          b.powerReason = 'distribution_overloaded';
        } else {
          b.powerReason = 'insufficient_supply';
        }
      }
    }

    state.powerGenerated = totalPowerGen;
    state.powerAvailableGen = totalPowerGen;
    state.powerDistCapacity = totalPowerDistCap;
    state.powerDelivered = totalPowerDelivered;
    state.powerDemand = totalPowerDem;

    // --- 2. WATER NETWORK FLOOD FILL ---
    const waterTileNet = new Map<number, number>();
    const visitedWaterBuildings = new Set<number>();
    const waterGenByNet = new Map<number, number>();
    const waterDemByNet = new Map<number, number>();
    const waterDistCapByNet = new Map<number, number>();
    const waterOverloadedNets = new Set<number>();
    let nextWaterNetId = 1;

    const allWaterSources = state.buildings.filter((b) => {
      if (b.status === 'constructing') return false;
      const def = BUILDINGS[b.defId];
      return Boolean(def?.waterOutput && def.waterOutput > 0);
    });

    const getEffectiveWaterOutput = (b: BuildingInstance): number => {
      const def = BUILDINGS[b.defId];
      if (!def?.waterOutput || !b.enabled) return 0;
      if (def.minWorkers > 0 && b.assignedWorkers < def.minWorkers) return 0;
      return getBuildingStatsAtLevel(def, b.level).waterOutput;
    };

    const waterPolicyCut = state.activePolicies?.includes('eco_water_pact') ? 0.75 : 1.0;
    const getScaledWaterDemand = (b: BuildingInstance): number => {
      const def = BUILDINGS[b.defId];
      if (!def?.waterDemand || !b.enabled) return 0;
      const baseScaledDemand = getBuildingStatsAtLevel(def, b.level).waterDemand;
      return Math.max(
        1,
        Math.round(baseScaledDemand * climate.waterDemandMult * waterPolicyCut)
      );
    };

    const sortedWaterSources = [...allWaterSources].sort((a, b) => Number(b.enabled) - Number(a.enabled));

    for (const src of sortedWaterSources) {
      if (visitedWaterBuildings.has(src.id)) continue;
      const netId = nextWaterNetId++;
      let netGen = 0;
      let netDem = 0;
      let netTiles = 0;
      let netPumps = 0;
      let netSources = 0;
      const queue: Array<{ gx: number; gy: number; key: number }> = [];
      const enqueued = new Set<number>();

      const addBuildingToWaterNet = (b: BuildingInstance) => {
        if (visitedWaterBuildings.has(b.id)) return;
        visitedWaterBuildings.add(b.id);
        b.waterConnected = true;
        b.waterNetworkId = netId;
        const def = BUILDINGS[b.defId];
        if (!def) return;
        if (def.waterOutput && def.waterOutput > 0 && b.enabled) netSources++;
        netGen += getEffectiveWaterOutput(b);
        netDem += getScaledWaterDemand(b);

        const fp = getBuildingFootprint(def, b.rotation ?? 0);
        const aura = def.waterOutput && b.enabled ? 4 : 1;
        for (let dx = -aura; dx < fp.width + aura; dx++) {
          for (let dy = -aura; dy < fp.height + aura; dy++) {
            const tx = b.gx + dx;
            const ty = b.gy + dy;
            const tk = tileKey(tx, ty);
            if (enqueued.has(tk)) continue;
            const inFootprint = dx >= 0 && dx < fp.width && dy >= 0 && dy < fp.height;
            const orthoBorder =
              ((dx === -1 || dx === fp.width) && dy >= 0 && dy < fp.height) ||
              ((dy === -1 || dy === fp.height) && dx >= 0 && dx < fp.width);

            if (
              inFootprint ||
              (orthoBorder && (waterTiles.has(tk) || tileToBuilding.has(tk))) ||
              (def.waterOutput && b.enabled && (waterTiles.has(tk) || tileToBuilding.has(tk)))
            ) {
              enqueued.add(tk);
              queue.push({ gx: tx, gy: ty, key: tk });
            }
          }
        }
      };

      addBuildingToWaterNet(src);

      while (queue.length > 0) {
        const cur = queue.pop()!;
        const ck = cur.key;
        if (!waterTileNet.has(ck)) waterTileNet.set(ck, netId);
        if (waterTiles.has(ck)) {
          netTiles++;
          if (pumpKeySet.has(ck)) netPumps++;
        }

        const bList = tileToBuilding.get(ck);
        if (bList) {
          for (let bi = 0; bi < bList.length; bi++) addBuildingToWaterNet(bList[bi]);
        }

        if (waterTiles.has(ck)) {
          for (let d = 0; d < 4; d++) {
            const nx = cur.gx + DIRS[d][0];
            const ny = cur.gy + DIRS[d][1];
            const nk = tileKey(nx, ny);
            if (!enqueued.has(nk) && (waterTiles.has(nk) || tileToBuilding.has(nk))) {
              enqueued.add(nk);
              queue.push({ gx: nx, gy: ny, key: nk });
            }
          }
          if (pumpKeySet.has(ck)) {
            for (let rx = -5; rx <= 5; rx++) {
              for (let ry = -5; ry <= 5; ry++) {
                if (Math.abs(rx) + Math.abs(ry) > 5) continue;
                const pk = tileKey(cur.gx + rx, cur.gy + ry);
                const pBldgs = tileToBuilding.get(pk);
                if (pBldgs) {
                  for (let bi = 0; bi < pBldgs.length; bi++) addBuildingToWaterNet(pBldgs[bi]);
                }
              }
            }
          }
        }
      }

      waterGenByNet.set(netId, netGen);
      waterDemByNet.set(netId, netDem);
      const distCap = Math.max(180, netSources * 180 + netTiles * 22 + netPumps * 240);
      waterDistCapByNet.set(netId, distCap);
      if (netGen > distCap && netDem > distCap) {
        waterOverloadedNets.add(netId);
      }
    }

    const hasAnyWaterPipeNeighbor = (b: BuildingInstance): boolean => {
      const def = BUILDINGS[b.defId];
      if (!def) return false;
      const fp = getBuildingFootprint(def, b.rotation ?? 0);
      for (let dx = -1; dx <= fp.width; dx++) {
        for (let dy = -1; dy <= fp.height; dy++) {
          const isInsideOrOrtho =
            (dx >= 0 && dx < fp.width && dy >= 0 && dy < fp.height) ||
            ((dx === -1 || dx === fp.width) && dy >= 0 && dy < fp.height) ||
            ((dy === -1 || dy === fp.height) && dx >= 0 && dx < fp.width);
          if (!isInsideOrOrtho) continue;
          if (waterTiles.has(tileKey(b.gx + dx, b.gy + dy))) return true;
        }
      }
      return pumpCenters.some(
        (p) => this.minDistToFootprint(p.gx, p.gy, b.gx, b.gy, fp.width, fp.height) <= 5
      );
    };

    let totalWaterGen = 0;
    let totalWaterDistCap = 0;
    let totalWaterDelivered = 0;
    let totalWaterDem = 0;
    let wConn = 0;
    let wDisc = 0;
    let wShortage = 0;

    for (const src of allWaterSources) totalWaterGen += getEffectiveWaterOutput(src);
    for (const cap of waterDistCapByNet.values()) totalWaterDistCap += cap;

    for (let bi = 0; bi < state.buildings.length; bi++) {
      const b = state.buildings[bi];
      if (b.status === 'constructing') continue;
      const dem = getScaledWaterDemand(b);
      if (!b.enabled) {
        b.waterConnected = visitedWaterBuildings.has(b.id);
        b.waterSatisfaction = dem > 0 ? 0 : 1;
        b.waterReason = 'ok';
        continue;
      }

      if (!visitedWaterBuildings.has(b.id)) {
        b.waterConnected = false;
        b.waterNetworkId = 0;
        b.waterSatisfaction = dem > 0 ? 0 : 1;
        b.waterReason =
          dem > 0
            ? hasAnyWaterPipeNeighbor(b)
              ? 'disconnected_section_no_source'
              : 'not_connected_to_network'
            : 'ok';
        if (dem > 0) {
          totalWaterDem += dem;
          wDisc++;
        }
      } else {
        const netId = b.waterNetworkId ?? 0;
        const g = waterGenByNet.get(netId) ?? 0;
        const d = waterDemByNet.get(netId) ?? 0;
        const distCap = waterDistCapByNet.get(netId) ?? 999999;
        const effectiveCap = Math.min(g, distCap);
        const sat = d === 0 ? 1 : g <= 0 ? 0 : Math.min(1, effectiveCap / d);
        b.waterSatisfaction = sat;
        if (dem > 0) {
          totalWaterDem += dem;
          totalWaterDelivered += Math.round(dem * sat);
          wConn++;
          if (sat < 1) wShortage++;
        }
        if (sat >= 1 || dem === 0) {
          b.waterReason = 'ok';
        } else if (g <= 0) {
          b.waterReason = 'source_inactive';
        } else if (g > distCap && d > distCap) {
          b.waterReason = 'distribution_overloaded';
        } else {
          b.waterReason = 'insufficient_supply';
        }
      }
    }

    state.waterGenerated = totalWaterGen;
    state.waterAvailableGen = totalWaterGen;
    state.waterDistCapacity = totalWaterDistCap;
    state.waterDelivered = totalWaterDelivered;
    state.waterDemand = totalWaterDem;

    this.lastSnapshot = {
      powerTiles,
      waterTiles,
      powerTileNet,
      waterTileNet,
      powerOverloadedNets,
      waterOverloadedNets,
      substationCenters,
      pumpCenters,
    };

    state.utilitySummary = {
      powerConnectedCount: pConn,
      powerDisconnectedCount: pDisc,
      powerBrownoutCount: pBrownout,
      waterConnectedCount: wConn,
      waterDisconnectedCount: wDisc,
      waterShortageCount: wShortage,
      serviceCoveragePct: state.utilitySummary?.serviceCoveragePct ?? 0,
    };
  }
}

