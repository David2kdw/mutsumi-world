import type { EventDef, EventsData, GameEvent } from "./types.js";

/**
 * Build a flat id→EventDef lookup map from location-keyed events.json data.
 * Call once at scheduler init to avoid repeated O(n×m) scans.
 */
export function buildEventLookup(events: EventsData): Map<string, EventDef> {
  const map = new Map<string, EventDef>();
  for (const locEvents of Object.values(events)) {
    for (const def of locEvents) {
      map.set(def.id, def);
    }
  }
  return map;
}

/**
 * O(1) lookup of a predefined event definition.
 * Returns null for DM-custom events.
 */
export function findEventDef(
  eventId: string,
  lookup: Map<string, EventDef>,
): EventDef | null {
  return lookup.get(eventId) ?? null;
}

/**
 * Merge DM-provided event data with predefined event definition.
 *
 * - If the event id matches a predefined event → EventDef as base, DM fields override.
 *   This lets the DM only send { id, status } and get the rest auto-filled.
 * - If the event id is unknown → DM-custom event, use DM-provided fields directly.
 * - Ensures all required fields (name, type, rarity, description, location, status)
 *   have fallback values.
 */
export function mergeEvent(
  dmEvent: {
    id: string;
    name: string;
    type?: string;
    rarity?: string;
    description?: string;
    location: string;
    status: string;
    tags?: string[];
    resolve_hint?: string;
    npc_optional?: string;
    npc_required?: string[];
    condition?: string;
    season?: string;
  },
  lookup: Map<string, EventDef>,
): GameEvent {
  const predefined = lookup.get(dmEvent.id);

  if (predefined) {
    // Predefined event: EventDef as base, DM fields take precedence
    return {
      id: dmEvent.id,
      name: dmEvent.name || predefined.name,
      type: dmEvent.type || predefined.type,
      rarity: dmEvent.rarity || predefined.rarity,
      description: dmEvent.description || predefined.description,
      location: dmEvent.location || "", // predefined events don't have location — DM provides it
      status: dmEvent.status || "未处理",
      created_at: "", // set by caller (applyDMResponse)
      tags: dmEvent.tags ?? predefined.tags,
      resolve_hint: dmEvent.resolve_hint ?? predefined.resolve_hint,
      npc_optional: dmEvent.npc_optional ?? predefined.npc_optional,
      npc_required: dmEvent.npc_required ?? predefined.npc_required,
      condition: dmEvent.condition ?? predefined.condition,
      season: dmEvent.season ?? predefined.season,
    };
  }

  // DM-custom event: use what the DM provided
  return {
    id: dmEvent.id,
    name: dmEvent.name,
    type: dmEvent.type || "custom",
    rarity: dmEvent.rarity || "custom",
    description: dmEvent.description || dmEvent.name,
    location: dmEvent.location || "",
    status: dmEvent.status || "未处理",
    created_at: "", // set by caller (applyDMResponse)
    tags: dmEvent.tags,
    resolve_hint: dmEvent.resolve_hint,
    npc_optional: dmEvent.npc_optional,
    npc_required: dmEvent.npc_required,
    condition: dmEvent.condition,
    season: dmEvent.season,
  };
}
