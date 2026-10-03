// Tiny Army persona panel — mounted by tiny.js into #persona-stage. It's just the shared hero
// creator (heroCreator.js — recruit/stream/edit/voice/portrait, autosaved) with its barracks roster
// of saved heroes enabled.
import { mountHeroCreator, CLASS_SLUG } from '/web/heroCreator.js'

// Re-exported so existing importers (tiny.js) keep working.
export { CLASS_SLUG }

export function mountPersonaPanel(host) {
  mountHeroCreator(host, { showBarracks: true })
}
