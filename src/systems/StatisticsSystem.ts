import { BUILDINGS } from '../data/buildings.data';
import type { ChunkManager } from '../core/ChunkManager';
import {
  CitizenProfession,
  EmploymentStatus,
  WorldEngineState,
  ZONE_ID_TO_TYPE,
  ZONE_META,
  ZoneType,
} from '../core/GameState';
import { CHUNK_SIZE } from '../core/IsoMath';
import { getBuildingStatsAtLevel } from './BuildingSimulation';

export interface ProfessionStatRow {
  profession: CitizenProfession;
  label: string;
  count: number;
  pct: number;
}

export interface BreakdownRow {
  id: string;
  label: string;
  count: number;
  extra?: string;
}

export interface DistrictStatRow {
  zone: ZoneType;
  name: string;
  colorHex: string;
  tiles: number;
  buildings: number;
  workers: number;
}

export interface BuildingOccupancyRow {
  id: number;
  defId: string;
  name: string;
  kind: 'housing' | 'workplace';
  current: number;
  capacity: number;
  level: number;
  status: string;
}

export interface PopulationStatsSnapshot {
  total: number;
  capacity: number;
  availableWorkforce: number;
  totalJobs: number;
  occupiedJobs: number;
  vacantJobs: number;
  employed: number;
  unemployed: number;
  homeless: number;
  lifeExpectancy: number;
  sicknessRate: number;
  educationCoveragePct: number;
  healthcareCoveragePct: number;
  professions: ProfessionStatRow[];
  employmentBreakdown: BreakdownRow[];
  housingBreakdown: BreakdownRow[];
  industryBreakdown: BreakdownRow[];
  districtBreakdown: DistrictStatRow[];
  buildingRows: BuildingOccupancyRow[];
}

export const PROFESSION_LABELS: Record<CitizenProfession, string> = {
  executive: 'Corporate Executive',
  office_worker: 'Office Worker',
  factory_worker: 'Factory Worker',
  farmer: 'Farmer',
  fisherman: 'Fisherman',
  engineer: 'Engineer',
  construction_worker: 'Construction Worker',
  student: 'Student',
  teacher: 'Teacher / Professor',
  doctor: 'Doctor / Surgeon',
  nurse: 'Nurse / Medic',
  police: 'Police Officer',
  firefighter: 'Firefighter',
  gov_officer: 'Government Officer',
  shopkeeper: 'Merchant / Shopkeeper',
  chef: 'Baker / Food Crafter',
  miner: 'Miner / Quarryman',
  forester: 'Forester / Logger',
  courier: 'Courier / Driver',
  tourist: 'Visitor / Tourist',
  child: 'Child',
  teenager: 'Teenager / Youth',
  adult: 'General Citizen',
  elderly: 'Elderly / Retired',
};

const ALL_24_PROFESSIONS: CitizenProfession[] = [
  'executive',
  'office_worker',
  'factory_worker',
  'farmer',
  'fisherman',
  'engineer',
  'construction_worker',
  'student',
  'teacher',
  'doctor',
  'nurse',
  'police',
  'firefighter',
  'gov_officer',
  'shopkeeper',
  'chef',
  'miner',
  'forester',
  'courier',
  'tourist',
  'child',
  'teenager',
  'adult',
  'elderly',
];

export function resolveBuildingProfession(defId: string): CitizenProfession {
  const def = BUILDINGS[defId];
  if (!def) return 'factory_worker';

  if (def.subCategory === 'corporate') return 'executive';
  if (def.subCategory === 'fishing' || defId === 'fish_market') return 'fisherman';
  if (def.subCategory === 'farming' || def.category === 'agricultural') return 'farmer';
  if (def.isAutomatedTreePlantation || defId === 'lumber_mill' || defId === 'heavy_lumber_complex' || defId === 'sawmill_mega' || defId === 'plywood_factory') {
    return 'forester';
  }
  if (def.requiredDeposit || defId.includes('mine') || defId.includes('quarry')) return 'miner';
  if (defId === 'bakery' || defId === 'grain_mill' || defId.includes('food_processing') || defId.includes('dairy')) {
    return 'chef';
  }
  if (defId.includes('construction') || defId === 'brick_kiln' || defId === 'cement_kiln' || defId === 'cement_factory' || defId === 'brick_factory') {
    return 'construction_worker';
  }
  if (defId.includes('police') || defId === 'watchtower' || defId === 'court_house') return 'police';
  if (defId.includes('fire_')) return 'firefighter';
  if (def.category === 'healthcare') return defId.includes('clinic') || defId.includes('health') ? 'nurse' : 'doctor';
  if (def.category === 'educational') return 'teacher';
  if (def.category === 'government') return 'gov_officer';
  if (def.category === 'transportation') return 'courier';
  if (def.category === 'commercial') return def.subCategory === 'trade_port' ? 'office_worker' : 'shopkeeper';
  if (def.category === 'recreational') return 'tourist';
  if (def.workerClass === 'engineer') return 'engineer';
  return 'factory_worker';
}

export class StatisticsSystem {
  public static computeSnapshot(state: WorldEngineState, chunks: ChunkManager): PopulationStatsSnapshot {
    const total = Math.max(0, state.population.total);

    // 1. Professions map initialized for all 24 roles
    const profCounts: Record<CitizenProfession, number> = {
      executive: 0,
      office_worker: 0,
      factory_worker: 0,
      farmer: 0,
      fisherman: 0,
      engineer: 0,
      construction_worker: 0,
      student: 0,
      teacher: 0,
      doctor: 0,
      nurse: 0,
      police: 0,
      firefighter: 0,
      gov_officer: 0,
      shopkeeper: 0,
      chef: 0,
      miner: 0,
      forester: 0,
      courier: 0,
      tourist: 0,
      child: 0,
      teenager: 0,
      adult: 0,
      elderly: 0,
    };

    const empMap: Record<EmploymentStatus, number> = {
      employed: 0,
      unemployed: 0,
      student: 0,
      homemaker: 0,
      retired: 0,
    };

    // Cohort-anchored age & employment numbers
    for (const ch of state.population.cohorts) {
      empMap[ch.employmentStatus] = (empMap[ch.employmentStatus] ?? 0) + ch.count;
      if (ch.employmentStatus === 'student') {
        profCounts.student += ch.count;
      } else if (ch.employmentStatus === 'retired') {
        profCounts.elderly += ch.count;
      } else if (ch.ageGroup === 'child') {
        profCounts.child += ch.count;
      } else if (ch.ageGroup === 'underage' && ch.employmentStatus !== 'employed') {
        profCounts.teenager += ch.count;
      } else if (ch.employmentStatus === 'employed') {
        const b = ch.workplaceOrSchoolId
          ? state.buildings.find((item) => item.id === ch.workplaceOrSchoolId)
          : undefined;
        if (b) {
          const prof = resolveBuildingProfession(b.defId);
          if (prof === 'executive' && ch.count > 2) {
            const execShare = Math.max(1, Math.round(ch.count * 0.25));
            profCounts.executive += execShare;
            profCounts.office_worker += ch.count - execShare;
          } else {
            profCounts[prof] += ch.count;
          }
        } else {
          profCounts.adult += ch.count;
        }
      } else {
        profCounts.adult += ch.count;
      }
    }

    const professions: ProfessionStatRow[] = ALL_24_PROFESSIONS.map((profession) => ({
      profession,
      label: PROFESSION_LABELS[profession],
      count: profCounts[profession],
      pct: total > 0 ? Math.round((profCounts[profession] / total) * 100) : 0,
    })).sort((a, b) => b.count - a.count);

    // 2. Housing Breakdown
    const housingBuckets: Record<string, number> = {
      'Rural Huts': 0,
      'Cottages & Houses': 0,
      'Apartments & Condos': 0,
      'Skyscrapers & Mega Complexes': 0,
      'Special Housing (Gov/Worker/Student/Senior)': 0,
      Homeless: state.population.homeless ?? 0,
    };

    const buildingResidents = new Map<number, number>();
    for (const ch of state.population.cohorts) {
      if (ch.homeBuildingId !== null) {
        buildingResidents.set(ch.homeBuildingId, (buildingResidents.get(ch.homeBuildingId) ?? 0) + ch.count);
      }
    }

    const industryBuckets: Record<string, number> = {
      'Government & Civic': 0,
      'Markets & Trade': 0,
      'Corporate Offices': 0,
      'Mega-Factories & Industry': 0,
      'Timber, Mining & Construction': 0,
      'Farming & Agriculture': 0,
      'Fishing & Maritime': 0,
      'Transit & Logistics': 0,
      'Education & Research': 0,
      'Healthcare Services': 0,
      'Utilities & Parks': 0,
    };

    const districtTiles: Record<ZoneType, number> = {} as Record<ZoneType, number>;
    const districtBuildings: Record<ZoneType, number> = {} as Record<ZoneType, number>;
    const districtWorkers: Record<ZoneType, number> = {} as Record<ZoneType, number>;
    for (const z of Object.keys(ZONE_META) as ZoneType[]) {
      districtTiles[z] = 0;
      districtBuildings[z] = 0;
      districtWorkers[z] = 0;
    }

    for (const chunk of chunks.getAllLoadedChunks()) {
      if (!chunk.isModified) continue;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const zt = ZONE_ID_TO_TYPE[chunk.zoneType[i]] ?? 'none';
        if (zt !== 'none') {
          districtTiles[zt] = (districtTiles[zt] ?? 0) + 1;
        }
      }
    }

    const buildingRows: BuildingOccupancyRow[] = [];

    for (const b of state.buildings) {
      const def = BUILDINGS[b.defId];
      if (!def) continue;

      const tileZone = ZONE_ID_TO_TYPE[chunks.getTileZone(b.gx, b.gy)] ?? 'none';
      if (tileZone !== 'none') {
        districtBuildings[tileZone] += 1;
        districtWorkers[tileZone] += b.assignedWorkers;
      }

      if (b.status !== 'constructing' && (def.housingCapacity ?? 0) > 0) {
        const occ = buildingResidents.get(b.id) ?? 0;
        const cap = getBuildingStatsAtLevel(def, b.level).housingCapacity;
        if (b.defId === 'government_housing' || b.defId === 'worker_housing' || b.defId === 'student_dormitory' || b.defId === 'senior_living_complex') {
          housingBuckets['Special Housing (Gov/Worker/Student/Senior)'] += occ;
        } else if (def.subCategory === 'skyscraper' || (def.housingCapacity ?? 0) >= 60) {
          housingBuckets['Skyscrapers & Mega Complexes'] += occ;
        } else if ((def.housingCapacity ?? 0) >= 16) {
          housingBuckets['Apartments & Condos'] += occ;
        } else if ((def.housingCapacity ?? 0) >= 7) {
          housingBuckets['Cottages & Houses'] += occ;
        } else {
          housingBuckets['Rural Huts'] += occ;
        }
        buildingRows.push({
          id: b.id,
          defId: b.defId,
          name: def.name,
          kind: 'housing',
          current: occ,
          capacity: cap,
          level: b.level,
          status: b.status,
        });
      }

      if (b.status !== 'constructing' && def.maxWorkers > 0) {
        const w = b.assignedWorkers;
        if (def.category === 'government') industryBuckets['Government & Civic'] += w;
        else if (def.subCategory === 'corporate') industryBuckets['Corporate Offices'] += w;
        else if (def.category === 'commercial' || def.subCategory === 'market' || def.subCategory === 'trade_port') {
          industryBuckets['Markets & Trade'] += w;
        } else if (def.subCategory === 'fishing') industryBuckets['Fishing & Maritime'] += w;
        else if (def.subCategory === 'farming' || def.category === 'agricultural') {
          industryBuckets['Farming & Agriculture'] += w;
        } else if (def.category === 'transportation' || def.subCategory === 'transit') {
          industryBuckets['Transit & Logistics'] += w;
        } else if (def.category === 'educational') industryBuckets['Education & Research'] += w;
        else if (def.category === 'healthcare') industryBuckets['Healthcare Services'] += w;
        else if (def.category === 'energy' || def.category === 'environmental' || def.category === 'recreational') {
          industryBuckets['Utilities & Parks'] += w;
        } else if (
          def.isAutomatedTreePlantation ||
          def.requiredDeposit ||
          b.defId.includes('mine') ||
          b.defId.includes('quarry') ||
          b.defId.includes('lumber') ||
          b.defId.includes('sawmill') ||
          b.defId.includes('cement') ||
          b.defId.includes('brick')
        ) {
          industryBuckets['Timber, Mining & Construction'] += w;
        } else {
          industryBuckets['Mega-Factories & Industry'] += w;
        }

        buildingRows.push({
          id: b.id,
          defId: b.defId,
          name: def.name,
          kind: 'workplace',
          current: w,
          capacity: getBuildingStatsAtLevel(def, b.level).maxWorkers,
          level: b.level,
          status: b.status,
        });
      }
    }

    const districtBreakdown: DistrictStatRow[] = (Object.keys(ZONE_META) as ZoneType[])
      .filter((z) => z !== 'none')
      .map((zone) => ({
        zone,
        name: ZONE_META[zone].name,
        colorHex: ZONE_META[zone].colorHex,
        tiles: districtTiles[zone] ?? 0,
        buildings: districtBuildings[zone] ?? 0,
        workers: districtWorkers[zone] ?? 0,
      }))
      .sort((a, b) => b.tiles - a.tiles || b.buildings - a.buildings);

    const adults =
      state.population.availableWorkforce ??
      (state.population.ageBreakdown?.adult ??
        (total > 0 ? Math.max(0, total - Math.floor(total * 0.12) - Math.floor(total * 0.1) - Math.floor(total * 0.1)) : 0));
    const totalJobs = state.population.totalJobs ?? 0;
    const occupiedJobs = state.population.occupiedJobs ?? state.population.employed;
    const vacantJobs = state.population.vacantJobs ?? Math.max(0, totalJobs - occupiedJobs);

    return {
      total,
      capacity: state.population.capacity,
      availableWorkforce: adults,
      totalJobs,
      occupiedJobs,
      vacantJobs,
      employed: state.population.employed,
      unemployed: state.population.unemployed,
      homeless: state.population.homeless ?? 0,
      lifeExpectancy: Math.round(state.lifeExpectancy ?? 72),
      sicknessRate: Math.round(state.sicknessRate ?? 8),
      educationCoveragePct: Math.round((state.population.needs.education ?? 0) * 100),
      healthcareCoveragePct: Math.round((state.population.needs.healthcare ?? 1) * 100),
      professions,
      employmentBreakdown: [
        { id: 'employed', label: 'Employed Adults', count: empMap.employed },
        { id: 'unemployed', label: 'Unemployed Adults', count: empMap.unemployed },
        { id: 'student', label: 'Students in School', count: empMap.student },
        { id: 'homemaker', label: 'Children & Dependents', count: empMap.homemaker },
        { id: 'retired', label: 'Retired Seniors', count: empMap.retired },
      ],
      housingBreakdown: Object.entries(housingBuckets).map(([label, count], idx) => ({
        id: `hb_${idx}`,
        label,
        count,
      })),
      industryBreakdown: Object.entries(industryBuckets)
        .map(([label, count], idx) => ({ id: `ind_${idx}`, label, count }))
        .sort((a, b) => b.count - a.count),
      districtBreakdown,
      buildingRows: buildingRows.sort((a, b) => b.current - a.current),
    };
  }
}
