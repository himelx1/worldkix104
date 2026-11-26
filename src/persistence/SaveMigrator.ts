import { CoreEngine } from '../core/CoreEngine';
import { SCHEMA_VERSION, WorldEngineState } from '../core/GameState';
import { BUILDINGS } from '../data/buildings.data';
import { CitizenAccounting } from '../systems/CitizenAccounting';

export interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  migratedAt: number;
  backupCreated: boolean;
  backupId?: string;
  cityName: string;
  coinsBefore: number;
  coinsAfter: number;
  populationBefore: number;
  populationAfter: number;
  buildingsBefore: number;
  buildingsAfter: number;
  warnings: string[];
  validationPassed: boolean;
  validationErrors: string[];
}

export interface MigrationResult {
  ok: boolean;
  state?: WorldEngineState;
  error?: string;
  report?: MigrationReport;
}

export class SaveMigrator {
  public static migrate(raw: unknown, opts?: { backupId?: string; backupCreated?: boolean }): MigrationResult {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Malformed save payload' };
    }
    const candidate = raw as Partial<WorldEngineState>;
    const version = typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 0;

    if (version > SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Save schema v${version} is newer than app v${SCHEMA_VERSION}. Please update KUKUS.`,
      };
    }

    const seed = typeof candidate.worldSeed === 'number' ? candidate.worldSeed : 12345;
    const base = CoreEngine.createInitialState(seed);

    const coinsBefore = typeof candidate.coins === 'number' ? candidate.coins : base.coins;
    const popBefore = typeof candidate.population?.total === 'number' ? candidate.population.total : 0;
    const buildingsRaw = Array.isArray(candidate.buildings) ? candidate.buildings : [];
    const warnings: string[] = [];

    // Preserve and normalize cities
    const cityName = candidate.settings?.cityName || base.settings.cityName;
    const cities =
      Array.isArray(candidate.cities) && candidate.cities.length > 0
        ? candidate.cities.map((c) => ({ ...c }))
        : [
            {
              id: 1,
              name: cityName,
              color: '#f59e0b',
              createdTick: 0,
              taxRate: typeof candidate.taxRate === 'number' ? candidate.taxRate : 1.0,
              unlockedTiles: candidate.stats?.unlockedTiles ?? 20,
            },
          ];

    const unlockedBuildingLevels: Record<string, number> = {
      ...(candidate.unlockedBuildingLevels ?? {}),
    };

    const REMOVED_LEGACY_BUILDINGS = new Set([
      'woodcutter_camp',
      'forester_hut',
      'road_connector',
      'automated_logging_factory',
    ]);

    // Normalize buildings, compute blueprint levels, and enforce maxPerWorld safety
    const maxPerWorldSeen = new Map<string, number>();
    const normalizedBuildings = [];
    for (const b of buildingsRaw) {
      if (!b || typeof b !== 'object' || typeof b.defId !== 'string') continue;
      if (REMOVED_LEGACY_BUILDINGS.has(b.defId)) {
        warnings.push(`Removed obsolete forestry/connector building "${b.defId}" during save migration.`);
        delete unlockedBuildingLevels[b.defId];
        continue;
      }
      const def = BUILDINGS[b.defId];
      if (!def) {
        warnings.push(`Skipped unknown building "${b.defId}" during save migration.`);
        continue;
      }
      if (def.maxPerWorld !== undefined) {
        const seen = maxPerWorldSeen.get(b.defId) ?? 0;
        if (seen >= def.maxPerWorld) {
          warnings.push(`Removed duplicate ${def.name} (maxPerWorld=${def.maxPerWorld})`);
          continue;
        }
        maxPerWorldSeen.set(b.defId, seen + 1);
      }
      const lvl = Math.min(def.maxLevel, Math.max(1, Number(b.level ?? 1)));
      unlockedBuildingLevels[b.defId] = Math.max(unlockedBuildingLevels[b.defId] ?? 1, lvl);
      normalizedBuildings.push({
        ...b,
        level: lvl,
        rotation: (b.rotation === 1 ? 1 : 0) as 0 | 1,
        cityId: typeof b.cityId === 'number' && b.cityId > 0 ? b.cityId : cities[0].id,
      });
    }

    const migrated: WorldEngineState = {
      ...base,
      ...candidate,
      schemaVersion: SCHEMA_VERSION,
      resources: { ...base.resources, ...(candidate.resources ?? {}) },
      capacities: { ...base.capacities, ...(candidate.capacities ?? {}) },
      marketPrices: { ...base.marketPrices, ...(candidate.marketPrices ?? {}) },
      buildings: normalizedBuildings,
      unlockedBuildingLevels,
      cities,
      activeCityId:
        typeof candidate.activeCityId === 'number' && cities.some((c) => c.id === candidate.activeCityId)
          ? candidate.activeCityId
          : cities[0].id,
      nextCityId:
        typeof candidate.nextCityId === 'number'
          ? candidate.nextCityId
          : Math.max(...cities.map((c) => c.id), 1) + 1,
      zones: Array.isArray(candidate.zones) ? candidate.zones : [],
      population: {
        ...base.population,
        ...(candidate.population ?? {}),
        classes: { ...base.population.classes, ...(candidate.population?.classes ?? {}) },
        needs: { ...base.population.needs, ...(candidate.population?.needs ?? {}) },
        ageBreakdown: {
          ...base.population.ageBreakdown,
          ...(candidate.population?.ageBreakdown ?? {}),
        },
        cohorts: Array.isArray(candidate.population?.cohorts) ? candidate.population.cohorts : [],
      },
      environment: { ...base.environment, ...(candidate.environment ?? {}) },
      stats: { ...base.stats, ...(candidate.stats ?? {}) },
      settings: { ...base.settings, ...(candidate.settings ?? {}) },
      camera: { ...base.camera, ...(candidate.camera ?? {}) },
      activePolicies: Array.isArray(candidate.activePolicies) ? candidate.activePolicies : [],
      foreignCurrency: typeof candidate.foreignCurrency === 'number' ? candidate.foreignCurrency : 0,
      tradeBalance: typeof candidate.tradeBalance === 'number' ? candidate.tradeBalance : 0,
      customsFeeRate: typeof candidate.customsFeeRate === 'number' ? candidate.customsFeeRate : 0.08,
      lifeExpectancy: typeof candidate.lifeExpectancy === 'number' ? candidate.lifeExpectancy : 72,
      sicknessRate: typeof candidate.sicknessRate === 'number' ? candidate.sicknessRate : 8,
      showZoneBorders: Boolean(candidate.showZoneBorders),
      landModeActive: Boolean(candidate.landModeActive),
      corporateStats: Array.isArray(candidate.corporateStats) ? candidate.corporateStats : [],
      treePlantations:
        candidate.treePlantations && typeof candidate.treePlantations === 'object'
          ? candidate.treePlantations
          : {},
    };
    delete (migrated as unknown as Record<string, unknown>).loggingStats;
    delete (migrated as unknown as Record<string, unknown>).treeRegrowthQueue;

    CitizenAccounting.reconcileCohorts(migrated);

    // Post-migration invariant checks
    const validationErrors: string[] = [];
    if (migrated.coins !== coinsBefore) {
      validationErrors.push(`Coins mismatch: before=${coinsBefore}, after=${migrated.coins}`);
    }
    if (migrated.population.total !== popBefore) {
      validationErrors.push(`Population mismatch: before=${popBefore}, after=${migrated.population.total}`);
    }
    if (migrated.stats.unlockedTiles < 0) {
      validationErrors.push(`Invalid unlockedTiles count: ${migrated.stats.unlockedTiles}`);
    }
    const citizenInv = CitizenAccounting.validateInvariants(migrated);
    if (!citizenInv.valid) {
      validationErrors.push(...citizenInv.errors);
    }

    const report: MigrationReport = {
      fromVersion: version,
      toVersion: SCHEMA_VERSION,
      migratedAt: Date.now(),
      backupCreated: Boolean(opts?.backupCreated),
      backupId: opts?.backupId,
      cityName: migrated.settings.cityName,
      coinsBefore,
      coinsAfter: migrated.coins,
      populationBefore: popBefore,
      populationAfter: migrated.population.total,
      buildingsBefore: buildingsRaw.length,
      buildingsAfter: migrated.buildings.length,
      warnings,
      validationPassed: validationErrors.length === 0,
      validationErrors,
    };

    return {
      ok: validationErrors.length === 0,
      state: migrated,
      error: validationErrors.length > 0 ? validationErrors.join('; ') : undefined,
      report,
    };
  }
}
