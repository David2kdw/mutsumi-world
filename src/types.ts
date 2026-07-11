// ====== world.json ======

export interface WorldState {
  last_tick: string;          // "HH:MM"
  date: string;               // "YYYY-MM-DD"
  day_type: "weekday" | "saturday" | "sunday";
  _dm: DMState;
  _mutsumi: MutsumiState;
}

export interface DMState {
  weather: string;
  schedule: ScheduleEntry[];
  environment: string;
  active_events: ActiveEvent[];
}

export interface ScheduleEntry {
  start: string;    // "HH:MM"
  end: string;      // "HH:MM"
  location: string;
  activity: string;
}

export interface ActiveEvent {
  id: string;
  name: string;
  location: string;
  status: string;
}

export interface MutsumiState {
  position: LocationPosition | TravelingPosition;
  trajectory: TrajectoryEntry[];
}

export interface TrajectoryEntry {
  time: string;   // "HH:MM"
  note: string;
}

// ====== Position ======

export interface LocationPosition {
  type: "location";
  name: string;
}

export interface TravelingPosition {
  type: "traveling";
  from: string;
  to: string;
  route: string[];        // road network node IDs along the path
  progress: number;       // 0..1
  started_at: string;     // "HH:MM" departure time
}

export type Position = LocationPosition | TravelingPosition;

// ====== Map ======

export interface Coord {
  x: number;
  y: number;
}

export interface LocationDef {
  coord: Coord;
  area: string;
}

export interface RoadNode {
  id: string;
  coord: Coord;
}

export interface RoadEdge {
  from: string;
  to: string;
  distance: number;
}

export interface RoadNetwork {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface LocationsData {
  [name: string]: LocationDef;
}

// ====== Route ======

export interface RouteResult {
  nodes: string[];          // ordered node IDs from start to end
  totalDistance: number;    // meters
  estimatedMinutes: number; // at default 1.2 m/s
}

// ====== Schedule Template ======

export interface ScheduleTemplate {
  weekday: Record<string, string>;
  saturday: Record<string, string>;
  sunday: Record<string, string>;
  class_timetable: Record<string, string[]>;
}

// ====== Weather ======

export interface SeasonConfig {
  months: number[];
  pool: WeatherOption[];
}

export interface WeatherOption {
  type: string;
  weight: number;
}

export interface WeatherData {
  [season: string]: SeasonConfig;
}

// ====== Events ======

export interface EventDef {
  id: string;
  name: string;
  type: string;
  rarity: string;
  description: string;
  tags?: string[];
  resolve_hint?: string;
  npc_optional?: string;
  npc_required?: string[];
  condition?: string;
  season?: string;
}

export interface EventsData {
  [location: string]: EventDef[];
}

// ====== NPC ======

export interface NPCDef {
  display: string;
  speed: number;
  schedule: Record<string, NPCScheduleEntry[]>;
}

export interface NPCScheduleEntry {
  time: string;     // "HH:MM"
  from: string;
  to: string;
  activity: string;
}

export interface NPCsData {
  [id: string]: NPCDef;
}

// ====== NPC Runtime State ======

export interface NPCState {
  id: string;
  display: string;
  position: Position;
}

// ====== Rules ======

export interface RulesData {
  tone: string;
  environment_style: string;
  event_selection: string;
  movement_policy: string;
  continuity: string;
  max_events_per_day: number;
  event_cooldown: Record<string, string>;
  write_journal: boolean;
}

// ====== Tick Context (passed to DM) ======

export interface TickContext {
  time: string;
  current_segment: ScheduleEntry | null;
  next_segment: ScheduleEntry | null;
  next_segment_route: RouteResult | null;
  mutsumi_position: Position;
  npc_states: NPCState[];
}
