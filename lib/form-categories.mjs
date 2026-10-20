// form-categories.mjs — question→category taxonomy loader and classifier for
// the autonomous form engine. The taxonomy lives in
// templates/form-categories.yml (system layer: structure, matchers, aliases —
// candidate answer VALUES never live there; `answer` is a pointer into the
// user's config/profile.yml or cv.md resolved at runtime).
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { normalize } from './autofill-form-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_TAXONOMY_PATH = path.resolve(__dirname, '..', 'templates', 'form-categories.yml');

export const VALID_ANSWER_SOURCES = ['profile', 'policy', 'faq', 'planner', 'cv', 'none'];

// ---------------------------------------------------------------------------
// Loading & validation
// ---------------------------------------------------------------------------
export function loadCategoryTaxonomy({ filePath = DEFAULT_TAXONOMY_PATH, profile } = {}) {
  let raw;
  try {
    raw = yaml.load(fs.readFileSync(filePath, 'utf-8'));
  } catch (cause) {
    const error = new Error(`Failed to load form category taxonomy ${filePath}: ${cause.message}`);
    error.code = 'CAREER_OPS_FORM_CATEGORIES_INVALID';
    throw error;
  }
  const taxonomy = validateTaxonomy(raw, filePath);
  if (profile?.form_categories) applyUserOverrides(taxonomy, profile.form_categories);
  taxonomy.categories = Object.freeze(taxonomy.categories);
  taxonomy.byId = Object.freeze(taxonomy.byId);
  return Object.freeze(taxonomy);
}

function validateTaxonomy(raw, filePath) {
  if (!raw || !Array.isArray(raw.categories) || !raw.categories.length) {
    throw invalid(filePath, 'top-level "categories" must be a non-empty array');
  }
  const categories = [];
  const byId = new Map();
  for (const entry of raw.categories) {
    const id = entry?.id;
    if (!id) throw invalid(filePath, 'a category is missing its "id"');
    if (!/^[a-z0-9-]+$/.test(id)) throw invalid(filePath, `category "${id}" has an invalid id (lowercase letters, digits, dashes only)`);
    if (byId.has(id)) throw invalid(filePath, `duplicate category id "${id}"`);
    if (!Number.isFinite(entry.priority)) throw invalid(filePath, `category "${id}" is missing a numeric "priority"`);
    for (const flag of ['sensitive', 'llm_allowed']) {
      if (typeof entry[flag] !== 'boolean') throw invalid(filePath, `category "${id}" is missing boolean "${flag}"`);
    }
    if (entry.sensitive && entry.llm_allowed) {
      throw invalid(filePath, `category "${id}" is sensitive and llm_allowed — sensitive categories must never reach the planner`);
    }

    const patterns = entry.question_patterns ?? [];
    if (!Array.isArray(patterns)) throw invalid(filePath, `category "${id}": "question_patterns" must be an array`);
    if (!patterns.length && id !== 'unclassified') {
      throw invalid(filePath, `category "${id}" has no question_patterns (only "unclassified" may be empty)`);
    }
    const excludes = entry.excludes ?? [];
    if (!Array.isArray(excludes)) throw invalid(filePath, `category "${id}": "excludes" must be an array`);
    const compiledPatterns = [];
    const compiledExcludes = [];
    for (const pattern of patterns) {
      try {
        compiledPatterns.push(new RegExp(pattern, 'i'));
      } catch {
        throw invalid(filePath, `category "${id}" has a question_pattern that does not compile: ${pattern}`);
      }
    }
    for (const pattern of excludes) {
      try {
        compiledExcludes.push(new RegExp(pattern, 'i'));
      } catch {
        throw invalid(filePath, `category "${id}" has an exclude that does not compile: ${pattern}`);
      }
    }

    const answer = entry.answer ?? { source: 'none' };
    const source = answer.source ?? 'none';
    if (!VALID_ANSWER_SOURCES.includes(source)) {
      throw invalid(filePath, `category "${id}" has unknown answer.source "${source}"`);
    }
    if (source === 'profile' && !answer.key) {
      throw invalid(filePath, `category "${id}" has answer.source "profile" but no "key"`);
    }
    if (source === 'policy' && !answer.authorization_key) {
      throw invalid(filePath, `category "${id}" has answer.source "policy" but no "authorization_key"`);
    }
    const aliases = entry.option_aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some(group => !Array.isArray(group) || group.some(term => typeof term !== 'string'))) {
      throw invalid(filePath, `category "${id}": "option_aliases" must be an array of string arrays`);
    }

    const category = Object.freeze({
      id,
      priority: entry.priority,
      sensitive: entry.sensitive,
      llm_allowed: entry.llm_allowed,
      question_patterns: Object.freeze(compiledPatterns),
      excludes: Object.freeze(compiledExcludes),
      answer: Object.freeze({ ...answer }),
      option_aliases: Object.freeze(aliases.map(Object.freeze)),
    });
    byId.set(id, category);
    categories.push(category);
  }
  if (!byId.has('unclassified')) {
    throw invalid(filePath, 'the taxonomy must define an "unclassified" category');
  }
  categories.sort((a, b) => a.priority - b.priority); // stable: equal priorities keep file order
  return { categories, byId };
}

// User-layer overrides: config/profile.yml → form_categories is a list of
// { id, ...partialCategory } entries merged per-key (arrays replaced, not
// concatenated). Never adds new categories; unknown ids throw rather than
// silently misspelling a category into the void.
function applyUserOverrides(taxonomy, overrides) {
  if (!Array.isArray(overrides)) return;
  const byId = new Map(taxonomy.byId);
  for (const override of overrides) {
    const id = override?.id;
    if (!byId.has(id)) {
      throw new Error(`form_categories override references unknown category "${id}"`);
    }
    byId.set(id, validateTaxonomyEntryPatch(id, override, taxonomy.byId.get(id)));
  }
  const categories = [...taxonomy.categories].map(category => byId.get(category.id) || category);
  categories.sort((a, b) => a.priority - b.priority);
  taxonomy.categories = Object.freeze(categories);
  taxonomy.byId = Object.freeze(byId);
}

function validateTaxonomyEntryPatch(id, patch, base) {
  const merged = { ...base };
  for (const key of Object.keys(patch)) {
    if (key === 'id') continue;
    if (key === 'question_patterns' || key === 'excludes') {
      if (!Array.isArray(patch[key])) throw new Error(`form_categories override for "${id}" sets "${key}" to a non-array`);
      merged[key] = Object.freeze(patch[key].map(pattern => new RegExp(pattern, 'i')));
    } else if (key === 'option_aliases') {
      if (!Array.isArray(patch[key])) throw new Error(`form_categories override for "${id}" sets "option_aliases" to a non-array`);
      merged[key] = Object.freeze(patch[key].map(Object.freeze));
    } else {
      merged[key] = patch[key];
    }
  }
  if (merged.sensitive && merged.llm_allowed) {
    throw new Error(`form_categories override for "${id}" makes a sensitive category llm_allowed`);
  }
  return Object.freeze(merged);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
// context: question label (plus any engine-added hints) already passed through
// normalize(). Returns the matched category object; questions matching nothing
// land on "unclassified".
export function classifyQuestion(normalizedContext, taxonomy) {
  const context = normalize(normalizedContext);
  for (const category of taxonomy.categories) {
    if (category.id === 'unclassified') continue;
    if (category.excludes.some(pattern => pattern.test(context))) continue;
    if (category.question_patterns.some(pattern => pattern.test(context))) return category;
  }
  return taxonomy.byId.get('unclassified');
}

export function getCategory(taxonomy, id) {
  return taxonomy.byId.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Answer policy
// ---------------------------------------------------------------------------
// Resolves the deterministic answer for a category from the user-layer
// profile. Sources:
//   profile — dot-path lookup; returns { answer, source: 'profile:<key>' }.
//   policy  — authorization_key resolving to `true` → { policy: 'accept',
//             source: 'profile:<authorization_key>' }; an array value (e.g.
//             per-company legal_acknowledgements) is passed through as
//             { answer, source } for the engine's per-company matching.
//   faq / planner / cv / none — null here; the engine ladder handles them.
export function answerPolicy(category, profile) {
  const { source } = category.answer;
  if (source === 'profile') {
    const value = dotPathGet(profile, category.answer.key);
    if (value === undefined) return null;
    return { answer: value, source: `profile:${category.answer.key}` };
  }
  if (source === 'policy') {
    const value = dotPathGet(profile, category.answer.authorization_key);
    if (value === true) {
      return { policy: 'accept', source: `profile:${category.answer.authorization_key}` };
    }
    if (Array.isArray(value) && value.length) {
      return { answer: value, source: `profile:${category.answer.authorization_key}` };
    }
    return null;
  }
  return null;
}

export function aliasesFor(category) {
  return category.option_aliases ?? [];
}

export function dotPathGet(object, keyPath) {
  if (!object) return undefined;
  let current = object;
  for (const part of String(keyPath).split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function invalid(filePath, message) {
  const error = new Error(`Invalid form category taxonomy ${filePath}: ${message}`);
  error.code = 'CAREER_OPS_FORM_CATEGORIES_INVALID';
  return error;
}
