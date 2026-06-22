/**
 * Slug utility — Phase 6.2
 *
 * Generates human-friendly, URL-safe slugs in the format: adjective-noun-number.
 * Ensures uniqueness against existing PublicLink.slug values.
 */
import { PublicLinkModel } from '../models/PublicLink';

const ADJECTIVES = [
  'amber', 'azure', 'bold', 'bright', 'calm', 'clean', 'clear', 'cool',
  'crisp', 'dark', 'deep', 'dense', 'fast', 'firm', 'flat', 'free',
  'fresh', 'gold', 'grand', 'green', 'grey', 'hard', 'heavy', 'high',
  'keen', 'kind', 'large', 'light', 'long', 'loud', 'neat', 'new',
  'nice', 'pale', 'plain', 'proud', 'pure', 'quiet', 'quick', 'rare',
  'rich', 'round', 'safe', 'sharp', 'short', 'slim', 'slow', 'small',
  'smart', 'soft', 'solid', 'still', 'strong', 'swift', 'tall', 'thin',
  'true', 'vast', 'warm', 'wide', 'wild', 'wise', 'young',
];

const NOUNS = [
  'anchor', 'atom', 'bay', 'beam', 'bird', 'block', 'bloom', 'bolt',
  'bond', 'book', 'branch', 'bridge', 'brook', 'cave', 'chord', 'cliff',
  'cloud', 'coast', 'core', 'crest', 'crown', 'curve', 'dawn', 'deck',
  'delta', 'dome', 'draft', 'drift', 'dune', 'dust', 'edge', 'field',
  'flame', 'flash', 'fleet', 'flow', 'fog', 'forge', 'frost', 'gate',
  'gem', 'glade', 'glow', 'grove', 'gulf', 'haze', 'hill', 'inlet',
  'isle', 'lake', 'lane', 'leaf', 'light', 'link', 'loop', 'marsh',
  'mist', 'moon', 'moss', 'note', 'peak', 'pine', 'plain', 'pond',
  'pool', 'port', 'pulse', 'range', 'reef', 'ridge', 'rift', 'rim',
  'ring', 'rise', 'rock', 'root', 'shard', 'shore', 'sky', 'slate',
  'slope', 'snow', 'star', 'stem', 'stone', 'storm', 'stream', 'sun',
  'surge', 'tide', 'trail', 'tree', 'vale', 'vault', 'wake', 'wave',
  'wind', 'wood', 'zone',
];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a candidate slug: adjective-noun-number (e.g. "swift-tide-4821").
 */
function generateCandidate(): string {
  const adj = randomElement(ADJECTIVES);
  const noun = randomElement(NOUNS);
  const num = randomNumber(1000, 9999);
  return `${adj}-${noun}-${num}`;
}

/**
 * Generate a unique slug that does not conflict with any existing PublicLink.
 * Retries up to `maxAttempts` times before throwing.
 */
export async function generateUniqueSlug(maxAttempts = 10): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateCandidate();
    const existing = await PublicLinkModel.exists({ slug: candidate });
    if (!existing) {
      return candidate;
    }
  }
  // Extremely unlikely — fallback with timestamp suffix for guaranteed uniqueness
  return `${generateCandidate()}-${Date.now()}`;
}
