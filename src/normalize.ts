/**
 * Vision Frames v1 - Input Normalization (deterministic floor)
 * Single source of truth: spec/VisionFrames_v1.pdf Sections 2-3, 9 and System Flow step 2
 *
 * Silently strips disallowed framing words and removes:
 * - Actions/poses
 * - Objects/props
 * - Jobs/roles/outcomes
 * - Commands/instructions
 *
 * Never notifies the user.
 *
 * R1 calls for an LLM to produce Clean Intent. That step is pluggable (see
 * semanticNormalizer.ts); this deterministic filter always runs, on raw input when no
 * LLM is configured and on the LLM's output when one is, so a listed term can never
 * reach the prompt either way.
 *
 * Matching is whole-word with inflections, never raw substring deletion, so safe words
 * such as "grounded", "household" or "understanding" survive.
 */

import { LIMITS } from './config';
import { CleanIntent, RawInput } from './schema';

/**
 * Disallowed framing per PDF Section 2 and System Flow step 2
 */
const DISALLOWED_FRAMING = [
  'manifest(?:s|ed|ing|ation|ations)?',
  'simulat(?:e|es|ed|ing|ion|ions)',
  'role[- ]?play(?:s|ed|ing)?',
  'wealth(?:y|ier|iest)?',
  'rich(?:er|est)?',
  'success(?:es|ful|fully)?',
  'hustl(?:e|es|ed|er|ers|ing)',
  'grind(?:s|ing|er|ers)?',
  'fantas(?:y|ies|ize|izing|tical)',
  'dream[- ]?(?:life|lifestyle)',
  'glow[- ]?ups?',
  'upgrad(?:e|es|ed|ing)',
];

/**
 * Actions and poses. Users may not provide any action or pose (PDF Section 3);
 * the canonical prompt alone decides standing or walking.
 */
const ACTIONS = [
  'sit(?:s|ting)?',
  'sat',
  'seated',
  'hold(?:s|ing)?',
  'held',
  'work(?:s|ed|ing)?',
  'gestur(?:e|es|ed|ing)',
  'stand(?:s|ing)?',
  'walk(?:s|ed|ing)?',
  'strid(?:e|es|ing)',
  'pos(?:e|es|ed|ing)',
  'lean(?:s|ed|ing)?',
  'crouch(?:es|ed|ing)?',
  'kneel(?:s|ed|ing)?',
  'lying',
  'running',
  'jumping',
  'dancing',
  'exercising',
  'typing',
  'writing',
  'pointing',
  'reaching',
  'grabbing',
  'carrying',
  'lifting',
  'driving',
  'drinking',
  'eating',
  'talking',
  'speaking',
  'presenting',
  'performing',
  'celebrating',
  'cheering',
  'hugging',
  'shaking hands',
];

/**
 * Objects and props
 */
const OBJECTS = [
  'laptops?',
  'computers?',
  '(?:smart)?phones?',
  'tablets?',
  'books?',
  'notebooks?',
  'documents?',
  'papers?',
  'briefcases?',
  'bags?',
  'coffee',
  'drinks?',
  'wine',
  'champagne',
  'cigars?',
  'cigarettes?',
  'food',
  'cups?',
  'mugs?',
  'items?',
  'objects?',
  'props?',
  'tools?',
  'devices?',
  'equipment',
  'chairs?',
  'desks?',
  'sofas?',
  'couch(?:es)?',
  'benches',
  'bench',
  'cars?',
  'vehicles?',
  'motorcycles?',
  'watch(?:es)?',
  'jewelry',
  'jewellery',
  'money',
  'cash',
  'cheques?',
  'trophy',
  'trophies',
  'awards?',
  'microphones?',
  'cameras?',
  'guitars?',
];

/**
 * Jobs, roles, outcomes, and status signals (PDF Sections 3 and 9)
 */
const ROLES_AND_OUTCOMES = [
  'ceos?',
  'founders?',
  'co-?founders?',
  'entrepreneurs?',
  'executives?',
  'managers?',
  'boss(?:es)?',
  'leaders?',
  'creators?',
  'builders?',
  'owners?',
  'investors?',
  'directors?',
  'presidents?',
  'millionaires?',
  'billionaires?',
  'moguls?',
  'tycoons?',
  'influencers?',
  'celebrit(?:y|ies)',
  'experts?',
  'champions?',
  'winners?',
  'achiev(?:e|es|ed|ing|ement|ements)',
  'accomplish(?:ed|ment|ments)',
  'goals?',
  'promot(?:ed|ion|ions)',
  'income',
  'salary',
  'salaries',
  'profits?',
  'revenue',
  'business(?:es)?',
  'compan(?:y|ies)',
  'startups?',
  'careers?',
  'jobs?',
  'fame',
  'famous',
  'status',
  'vip',
  'luxur(?:y|ies|ious)',
  'lavish',
  'opulent',
  'expensive',
  'designer',
  'mansions?',
  'penthouses?',
  'yachts?',
  'private jets?',
  'jets?',
  'supercars?',
  // Brands that read as status signals or focal props
  'lamborghinis?',
  'ferraris?',
  'porsches?',
  'bentleys?',
  'rolls[- ]royces?',
  'maseratis?',
  'bugattis?',
  'mclarens?',
  'corvettes?',
  'bmws?',
  'mercedes(?:-benz)?',
  'teslas?',
  'rolex(?:es)?',
  'gucci',
  'prada',
  'louis vuitton',
  'chanel',
  'herm[e\u00e8]s',
  'cartier',
];

/**
 * Command verbs removed wherever they appear
 */
const COMMAND_VERBS = [
  'make',
  'create',
  'generate',
  'show(?:s|n|ed|ing)?',
  'display(?:s|ed|ing)?',
  'depict(?:s|ed|ing)?',
  'illustrat(?:e|es|ed|ing)',
  'draw(?:s|n|ing)?',
  'render(?:s|ed|ing)?',
  'produc(?:e|es|ed|ing)',
];

/**
 * A clause matching any of these is an instruction aimed at the system rather than a
 * description of identity, environment, or mood. The whole clause is dropped.
 */
const INSTRUCTION_CLAUSE_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b/i,
  /\b(?:instructions?|prompts?|system|rules?|guidelines?|polic(?:y|ies))\b/i,
  /\byou\s+(?:are|must|should|will|need|have|can)\b/i,
  /\b(?:act|pretend|behave)\s+(?:as|like)\b/i,
  /\b(?:image|picture|photo|photograph|portrait|render|shot)\s+of\b/i,
  /^(?:please\s+)?(?:make|create|generate|show|display|depict|illustrate|draw|render|produce|add|put|place|give|include|change|turn|use|paint|design|imagine|let)\b/i,
];

/**
 * Function words that are left dangling when the words around them are removed
 */
const FUNCTION_WORDS = new Set([
  'and', 'or', 'but', 'with', 'without', 'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to',
  'for', 'by', 'from', 'into', 'near', 'next', 'beside', 'while', 'as', 'like', 'then',
]);

/** Placeholder for a removed term while dangling function words are cleaned up */
const GAP = 'VFGAP';

const STRIP_PATTERN = new RegExp(
  `\\b(?:${[...DISALLOWED_FRAMING, ...ACTIONS, ...OBJECTS, ...ROLES_AND_OUTCOMES, ...COMMAND_VERBS].join('|')})\\b`,
  'gi'
);

// Control and zero-width characters are matched on purpose so they cannot hide terms
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/**
 * Normalize a single field by removing disallowed content
 */
export function normalizeField(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Line breaks end a clause; every other control or invisible character becomes a space
  const clauses = input
    .normalize('NFKC')
    .split(/[.,;:!?\n\r\u2028\u2029]+/)
    .map((clause) => clause.replace(INVISIBLE_CHARACTERS, ' ').replace(/\s+/g, ' ').trim())
    .filter((clause) => clause.length > 0)
    .filter((clause) => !INSTRUCTION_CLAUSE_PATTERNS.some((pattern) => pattern.test(clause)))
    .map(cleanClause)
    .filter((clause) => clause.length > 0);

  return truncate(clauses.join(', '), LIMITS.maxCleanFieldLength);
}

function cleanClause(clause: string): string {
  const tokens = clause
    .replace(STRIP_PATTERN, ` ${GAP} `)
    .replace(/["'`*_#<>{}[\]()|\\/^~=+@$%&]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^-+$/.test(token));

  const isFunctionWord = (token: string | undefined) => token !== undefined && FUNCTION_WORDS.has(token.toLowerCase());

  // Drop runs of function words that sit between removed terms or a removed term and the
  // clause edge ("sitting in a chair" -> ""), but keep the user's phrasing elsewhere
  // ("standing in a quiet city" -> "in a quiet city").
  const kept: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isFunctionWord(tokens[i])) {
      kept.push(tokens[i]);
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < tokens.length && isFunctionWord(tokens[end + 1])) {
      end++;
    }
    const left = tokens[i - 1];
    const right = tokens[end + 1];
    const leftOpen = left === undefined || left === GAP;
    const rightOpen = right === undefined || right === GAP;
    if (!(leftOpen && rightOpen && (left === GAP || right === GAP))) {
      kept.push(...tokens.slice(i, end + 1));
    }
    i = end + 1;
  }

  const words = kept.filter((token) => token !== GAP);
  return words.every((word) => isFunctionWord(word)) ? '' : words.join(' ');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,\s]+$/, '');
}

/**
 * Normalize user input into Clean Intent
 * Silently strips all disallowed content per PDF Section 3
 *
 * identityDirection may come back empty when nothing safe remains; the engine ends the
 * run before generation in that case (docs/DECISIONS.md P-08).
 */
export function normalize(input: RawInput): CleanIntent {
  const cleanIntent: CleanIntent = {
    identityDirection: normalizeField(input?.identityDirection),
  };

  const environment = normalizeField(input?.environmentPreference);
  if (environment) {
    cleanIntent.environmentPreference = environment;
  }

  const mood = normalizeField(input?.moodTone);
  if (mood) {
    cleanIntent.moodTone = mood;
  }

  return cleanIntent;
}
