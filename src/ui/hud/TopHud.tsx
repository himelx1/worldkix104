import React from 'react';
import {
  CloudRain,
  Coins,
  Menu,
  Moon,
  Pause,
  Play,
  FastForward,
  Sun,
  Sunrise,
  Sunset,
  Snowflake,
  Users,
  Zap,
  Trees,
  Box,
  Wheat,
  FlaskConical,
  Smile,
  Meh,
  Frown,
  ChevronRight,
  Globe,
  Map as MapIcon,
} from 'lucide-react';
import { formatCompactNumber } from '../../core/Formatters';
import { getXpForNextLevel } from '../../data/levels.data';
import { ResourceSystem } from '../../systems/ResourceSystem';
import { GameController, GameSnapshot } from '../bridge/GameController';

interface TopHudProps {
  snap: GameSnapshot;
}

export const TopHud: React.FC<TopHudProps> = ({ snap }) => {
  const { state } = snap;
  const xpReq = getXpForNextLevel(state.level);
  const xpPct = Math.min(100, Math.round((state.xp / xpReq) * 100));
  const totalFood = Math.floor(ResourceSystem.getTotalFoodUnits(state));
  const happiness = Math.round(state.population.happiness ?? 75);
  const HappyIcon = happiness >= 72 ? Smile : happiness >= 45 ? Meh : Frown;
  const happyColor =
    happiness >= 72
      ? 'text-emerald-300 border-emerald-700/60 bg-emerald-950/75'
      : happiness >= 45
        ? 'text-amber-300 border-amber-700/60 bg-amber-950/75'
        : 'text-red-300 border-red-700/60 bg-red-950/75';

  const tod = Number.isFinite(state.timeOfDayHours) ? (((state.timeOfDayHours % 24) + 24) % 24) : 8.5;
  const totalGameMins = Math.floor(tod * 60 + 1e-6) % 1440;
  const rawH = Math.floor(totalGameMins / 60);
  const mm = totalGameMins % 60;
  const ampm = rawH >= 12 ? 'PM' : 'AM';
  const hh = rawH % 12 === 0 ? 12 : rawH % 12;
  const clockStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;

  const isNight = tod >= 19.75 || tod < 4.25;
  const isDawn = tod >= 4.25 && tod < 6.0;
  const isMorning = tod >= 6.0 && tod < 8.0;
  const isSunset = tod >= 16.0 && tod < 18.25;
  const isDusk = tod >= 18.25 && tod < 19.75;
  const dayPhaseLabel = isNight
    ? 'Night'
    : isDawn
      ? 'Dawn'
      : isMorning
        ? 'Morning'
        : isSunset
          ? 'Sunset'
          : isDusk
            ? 'Dusk'
            : 'Day';

  const TimeIcon =
    state.weather === 'rain' || state.weather === 'storm'
      ? CloudRain
      : state.weather === 'snow'
        ? Snowflake
        : isNight
          ? Moon
          : isDawn || isMorning
            ? Sunrise
            : isSunset || isDusk
              ? Sunset
              : Sun;

  const seasonLabel = state.season.charAt(0).toUpperCase() + state.season.slice(1);
  const weatherLabel = state.weather.charAt(0).toUpperCase() + state.weather.slice(1);
  const nextWeather = (state.nextWeather ?? 'clear');
  const nextWeatherLabel = nextWeather.charAt(0).toUpperCase() + nextWeather.slice(1);
  const festivalSec = state.festivalTicksRemaining ?? 0;
  const activeEv = state.activeEvent;
  const pausedCount = state.buildings.filter((b) => !b.enabled).length;
  const fxAmount = Math.floor(state.foreignCurrency ?? 0);
  const showFx = fxAmount > 0 || (state.tradeBalance ?? 0) !== 0;

  return (
    <header className="pointer-events-auto w-full max-w-full overflow-hidden bg-gradient-to-b from-[#13291e]/96 to-[#08150f]/95 backdrop-blur-md border-b border-emerald-700/45 pt-safe px-2.5 pb-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.45)]">
      {/* Row 1: Level Crest + City + Calendar/Clock/Speed + Menu */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
          {/* Sculpted Level Crest */}
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 font-extrabold text-xs flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_2px_0_#78350f] tabular-nums">
            {state.level}
          </div>

          <div className="flex flex-col justify-center flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-1.5 text-[11px] sm:text-xs font-semibold text-stone-100 whitespace-nowrap min-w-0">
              <span className="truncate min-w-0">{state.settings.cityName}</span>
              <span className="text-[10px] font-medium text-amber-300/90 tabular-nums shrink-0">
                {formatCompactNumber(state.xp)}/{formatCompactNumber(xpReq)}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#05100b] border border-emerald-900/70 rounded-sm overflow-hidden mt-0.5">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all duration-200"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Clock · Season · Weather Forecast · Speed Controls · Menu */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <div className="flex items-center gap-1 text-[11px] text-stone-200 tabular-nums whitespace-nowrap">
            <TimeIcon
              className={`w-3.5 h-3.5 shrink-0 ${
                isNight
                  ? 'text-sky-300'
                  : isDawn || isDusk || isSunset
                    ? 'text-orange-300'
                    : 'text-amber-300'
              }`}
            />
            <span className="font-semibold">{clockStr}</span>
            <span className="hidden md:inline text-stone-300/90 text-[10px] font-medium">{dayPhaseLabel}</span>
            <span className="hidden lg:inline text-stone-400">
              · {seasonLabel} D{state.dayInSeason} · {weatherLabel} → {nextWeatherLabel}
            </span>
          </div>

          <div className="flex items-center bg-[#06120c] border border-emerald-800/60 rounded-xl p-0.5 shadow-inner">
            <button
              type="button"
              aria-label="Pause"
              onClick={() => GameController.dispatch({ type: 'SET_SPEED', speed: 0 })}
              className={`min-w-[26px] sm:min-w-[30px] h-7 flex items-center justify-center rounded-lg text-xs transition-all ${
                state.speed === 0
                  ? 'bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <Pause className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              type="button"
              aria-label="1x Speed"
              onClick={() => GameController.dispatch({ type: 'SET_SPEED', speed: 1 })}
              className={`min-w-[26px] sm:min-w-[30px] h-7 flex items-center justify-center rounded-lg text-xs transition-all ${
                state.speed === 1
                  ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              type="button"
              aria-label="2x Speed"
              onClick={() => GameController.dispatch({ type: 'SET_SPEED', speed: 2 })}
              className={`min-w-[26px] sm:min-w-[30px] h-7 px-0.5 sm:px-1 flex items-center justify-center rounded-lg text-[10px] sm:text-[11px] tabular-nums transition-all ${
                state.speed === 2
                  ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              2×
            </button>
            <button
              type="button"
              aria-label="3x Speed"
              onClick={() => GameController.dispatch({ type: 'SET_SPEED', speed: 3 })}
              className={`min-w-[26px] sm:min-w-[30px] h-7 px-0.5 sm:px-1 flex items-center justify-center rounded-lg text-[10px] sm:text-[11px] tabular-nums transition-all ${
                state.speed === 3
                  ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <FastForward className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>

          <button
            type="button"
            aria-label="Menu"
            onClick={() => GameController.setActiveModal('pause')}
            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl bg-gradient-to-b from-[#163124] to-[#0c1e16] border border-emerald-700/60 text-stone-100 hover:border-emerald-500/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Row 2: Sculpted Resource Tray (Inventory) + Tappable Happiness Guide Shortcut */}
      <div className="mt-1.5 w-full min-w-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => GameController.setActiveSheet('inventory')}
          className="flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl bg-[#06120c]/85 border border-emerald-900/70 px-2.5 py-1 text-xs tabular-nums whitespace-nowrap shadow-inner hover:border-emerald-700/70 transition-colors"
        >
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar min-w-0">
            <span className="inline-flex items-center gap-1 text-amber-300 font-bold shrink-0">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              {formatCompactNumber(state.coins)}
            </span>
            <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
            <span className="inline-flex items-center gap-1 text-lime-300 font-medium shrink-0">
              <Trees className="w-3.5 h-3.5 text-lime-400" />
              {formatCompactNumber(state.resources.wood)}
            </span>
            <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
            <span className="inline-flex items-center gap-1 text-stone-200 font-medium shrink-0">
              <Box className="w-3.5 h-3.5 text-stone-400" />
              {formatCompactNumber(state.resources.stone)}
            </span>
            <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
            <span className="inline-flex items-center gap-1 text-orange-300 font-medium shrink-0">
              <Wheat className="w-3.5 h-3.5 text-orange-400" />
              {formatCompactNumber(totalFood)}
            </span>
            <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
            <span className="inline-flex items-center gap-1 text-sky-300 font-medium shrink-0">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              {formatCompactNumber(state.population.total)}/{formatCompactNumber(state.population.capacity)}
            </span>
            <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
            <span className="inline-flex items-center gap-1 text-indigo-300 font-medium shrink-0">
              <FlaskConical className="w-3.5 h-3.5 text-indigo-400" />
              {formatCompactNumber(state.researchPoints)}
            </span>
            {showFx ? (
              <>
                <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
                <span className="inline-flex items-center gap-1 text-cyan-300 font-semibold shrink-0">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  {formatCompactNumber(fxAmount)} FX
                </span>
              </>
            ) : null}
            {state.powerDemand > 0 || state.powerGenerated > 0 ? (() => {
              const delivered = state.powerDelivered ?? state.powerGenerated;
              const powerColor =
                delivered >= state.powerDemand
                  ? 'text-emerald-300'
                  : state.powerGenerated >= state.powerDemand
                    ? 'text-amber-300'
                    : 'text-red-400';
              return (
                <>
                  <span className="w-px h-3 bg-emerald-900/80 shrink-0" />
                  <span
                    title={`Delivered ${delivered} MW / Demand ${state.powerDemand} MW (Total Capacity ${state.powerGenerated} MW)`}
                    className={`inline-flex items-center gap-1 font-medium shrink-0 ${powerColor}`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {delivered}/{state.powerDemand}MW
                  </span>
                </>
              );
            })() : null}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-emerald-500/80 shrink-0" />
        </button>

        <button
          type="button"
          aria-label={`Happiness ${happiness}% — open guide`}
          onClick={() => GameController.setActiveSheet('population')}
          className={`shrink-0 h-7 px-2 rounded-xl border text-xs font-bold tabular-nums flex items-center gap-1 transition-colors ${happyColor}`}
        >
          <HappyIcon className="w-3.5 h-3.5 shrink-0" />
          <span>{happiness}%</span>
        </button>
      </div>

      {festivalSec > 0 || activeEv || pausedCount > 0 ? (
        <div className="mt-1 flex items-center justify-between gap-2 px-2 py-0.5 rounded-lg bg-amber-950/60 border border-amber-700/40 text-[11px] text-amber-200 tabular-nums">
          {festivalSec > 0 ? (
            <span className="truncate font-semibold">
              City Festival Active (+50% Tax &amp; Happiness) · {festivalSec}s
            </span>
          ) : activeEv ? (
            <span className="truncate font-medium">
              {activeEv.title}: {activeEv.description} · {activeEv.ticksRemaining}s
            </span>
          ) : (
            <span className="truncate font-medium text-stone-200">
              {pausedCount} {pausedCount === 1 ? 'building' : 'buildings'} paused
            </span>
          )}
          {pausedCount > 0 ? (
            <button
              type="button"
              onClick={() => GameController.dispatch({ type: 'RESUME_ALL_BUILDINGS' })}
              className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] shrink-0"
            >
              Resume All ({pausedCount})
            </button>
          ) : null}
        </div>
      ) : null}

      {state.landModeActive || state.showZoneBorders ? (
        <button
          type="button"
          onClick={() => GameController.setActiveToolPanel('view')}
          className="mt-1 w-full flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-sky-950/75 hover:bg-sky-900/80 border border-sky-600/50 text-[11px] text-sky-100 tabular-nums transition-colors"
        >
          <span className="flex items-center gap-1.5 truncate font-semibold">
            <MapIcon className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            {state.landModeActive && state.showZoneBorders
              ? 'Land View & Borders Active'
              : state.landModeActive
                ? 'Land View Active'
                : 'Border Mode ON'}
          </span>
          <span className="text-[10px] font-bold text-amber-300 shrink-0">View Options</span>
        </button>
      ) : null}
    </header>
  );
};
