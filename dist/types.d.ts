export interface WorldState {
    last_tick: string;
    date: string;
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
    start: string;
    end: string;
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
    time: string;
    note: string;
}
export interface LocationPosition {
    type: "location";
    name: string;
}
export interface TravelingPosition {
    type: "traveling";
    from: string;
    to: string;
    route: string[];
    progress: number;
    started_at: string;
}
export type Position = LocationPosition | TravelingPosition;
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
export interface RouteResult {
    nodes: string[];
    totalDistance: number;
    estimatedMinutes: number;
}
export interface ScheduleTemplate {
    weekday: Record<string, string>;
    saturday: Record<string, string>;
    sunday: Record<string, string>;
    class_timetable: Record<string, string[]>;
}
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
export interface NPCDef {
    display: string;
    speed: number;
    schedule: Record<string, NPCScheduleEntry[]>;
}
export interface NPCScheduleEntry {
    time: string;
    from: string;
    to: string;
    activity: string;
}
export interface NPCsData {
    [id: string]: NPCDef;
}
export interface NPCState {
    id: string;
    display: string;
    position: Position;
}
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
export interface TickContext {
    time: string;
    current_segment: ScheduleEntry | null;
    next_segment: ScheduleEntry | null;
    next_segment_route: RouteResult | null;
    mutsumi_position: Position;
    npc_states: NPCState[];
}
