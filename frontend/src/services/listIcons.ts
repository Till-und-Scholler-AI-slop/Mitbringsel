import type { ListIcon } from '@/types/api'

/** What a new list gets unless someone picks another icon; the backend's default too. */
export const DEFAULT_LIST_ICON: ListIcon = 'general'

export type ListIconGroup = 'food' | 'household' | 'other'

/**
 * The icons in the groups and order of the design ("icons3-sticker"). Every
 * icon of the API contract appears exactly once; a test checks that.
 */
export const LIST_ICON_GROUPS: { key: ListIconGroup; icons: ListIcon[] }[] = [
  { key: 'food', icons: ['supermarket', 'market', 'bakery', 'butcher', 'drinks', 'organic'] },
  { key: 'household', icons: ['drugstore', 'pharmacy', 'baby', 'pets', 'hardware', 'garden'] },
  {
    key: 'other',
    icons: ['furniture', 'electronics', 'stationery', 'clothing', 'online', 'general'],
  },
]

interface SuggestionRule {
  icon: ListIcon
  /** Exact whole-word tokens (safe for short/ambiguous names like "dm" or "obi"). */
  words?: readonly string[]
  /** Exact phrases (multi-word or containing "&", matched on token boundaries). */
  phrases?: readonly string[]
  /** Unambiguous stems matched anywhere in the normalized name (handles German compounds). */
  contains?: readonly string[]
  /** Token suffixes (used for generic "*markt" fallback after specific store types). */
  suffixes?: readonly string[]
}

/**
 * Ordered from more specific to more general so compound names resolve to the
 * specific store (e.g. "Globus Baumarkt" -> hardware, "Bio Supermarkt" -> organic,
 * "Kindergarten" -> baby, "Kinderkleidung" -> clothing, "Baumarkt" -> hardware
 * before the generic "*markt" fallback to market).
 */
const ICON_SUGGESTION_RULES: readonly SuggestionRule[] = [
  {
    icon: 'pharmacy',
    words: ['chemist', 'rezept', 'rezepte', 'vitamine', 'vitamins'],
    contains: [
      'apothek',
      'pharmac',
      'medikament',
      'medizin',
      'medicin',
      'arznei',
      'docmorris',
      'sanitatshaus',
      'sanitaetshaus',
    ],
  },
  {
    icon: 'hardware',
    words: ['obi', 'toom', 'diy', 'lowes', 'tools', 'bau'],
    phrases: ['home depot', 'leroy merlin', 'b&q'],
    contains: [
      'baumarkt',
      'hardware',
      'hornbach',
      'bauhaus',
      'hagebau',
      'hellweg',
      'werkzeug',
      'werkstatt',
      'heimwerk',
      'renovier',
      'screwfix',
      'toolstation',
      'schrauben',
    ],
  },
  {
    icon: 'drugstore',
    words: ['dm', 'bipa', 'muller', 'mueller', 'cvs', 'boots', 'pflege', 'shampoo', 'seife'],
    contains: [
      'drogerie',
      'drugstore',
      'rossmann',
      'budni',
      'kosmetik',
      'cosmetic',
      'parfumerie',
      'parfuemerie',
      'perfumer',
      'hygiene',
      'toiletries',
      'douglas',
      'sephora',
      'walgreens',
    ],
  },
  {
    icon: 'organic',
    words: ['bio', 'oko', 'oeko'],
    phrases: ['whole foods', 'health food'],
    contains: [
      'bioladen',
      'biomarkt',
      'alnatura',
      'denns',
      'reformhaus',
      'unverpackt',
      'naturkost',
      'organic',
    ],
  },
  {
    icon: 'bakery',
    words: ['brot', 'bread', 'kuchen', 'brezel', 'semmel', 'croissant', 'pastry', 'pastries'],
    contains: [
      'backer',
      'baecker',
      'baker',
      'brotchen',
      'broetchen',
      'konditor',
      'patisser',
      'geback',
      'gebaeck',
    ],
  },
  {
    icon: 'butcher',
    words: ['deli'],
    contains: ['metzger', 'fleischer', 'schlachter', 'butcher', 'fleisch', 'wurst', 'feinkost'],
  },
  {
    icon: 'drinks',
    words: ['drinks', 'drink', 'wein', 'wine', 'bier', 'beer', 'kiosk', 'dursty'],
    contains: [
      'getrank',
      'getraenk',
      'trinkgut',
      'flaschenpost',
      'beverage',
      'liquor',
      'spirituos',
      'weinhandlung',
      'weinladen',
      'bierladen',
      'spati',
      'spaeti',
    ],
  },
  {
    icon: 'pets',
    words: [
      'pet',
      'pets',
      'zoo',
      'hund',
      'hunde',
      'dog',
      'dogs',
      'katze',
      'katzen',
      'cat',
      'cats',
      'tiere',
      'futter',
      'vet',
    ],
    contains: [
      'tierbedarf',
      'tierhandlung',
      'tierfutter',
      'tiermarkt',
      'tiernahrung',
      'tierarzt',
      'haustier',
      'fressnapf',
      'futterhaus',
      'zooplus',
      'zoohandlung',
      'hundefutter',
      'katzenfutter',
      'katzenstreu',
      'vogelfutter',
      'petshop',
      'petco',
      'petsmart',
      'aquarium',
      'terrarium',
    ],
  },
  {
    icon: 'electronics',
    words: [
      'saturn',
      'conrad',
      'expert',
      'tech',
      'pc',
      'tv',
      'handy',
      'kabel',
      'cables',
      'gadgets',
      'kamera',
      'camera',
      'gaming',
    ],
    phrases: ['media markt', 'best buy', 'micro center', 'apple store'],
    contains: [
      'elektronik',
      'electronic',
      'mediamarkt',
      'euronics',
      'cyberport',
      'alternate',
      'mindfactory',
      'notebooksbilliger',
      'technik',
      'computer',
      'laptop',
      'smartphone',
      'elektro',
    ],
  },
  {
    icon: 'furniture',
    words: [
      'ikea',
      'poco',
      'jysk',
      'porta',
      'roller',
      'deko',
      'decor',
      'wohnen',
      'interior',
      'sofa',
      'couch',
      'lampe',
      'lampen',
      'teppich',
    ],
    phrases: ['nanu nana'],
    contains: [
      'mobel',
      'moebel',
      'furniture',
      'xxxlutz',
      'segmuller',
      'segmueller',
      'hoffner',
      'hoeffner',
      'momax',
      'moemax',
      'sconto',
      'einrichtung',
      'bettenlager',
      'wayfair',
      'westwing',
      'home24',
      'butlers',
      'depot',
      'sostrene',
    ],
  },
  {
    icon: 'clothing',
    words: [
      'mode',
      'zara',
      'mango',
      'kik',
      'takko',
      'shoes',
      'schuh',
      'jacke',
      'hose',
      'hosen',
      'hemd',
      'kleider',
      'vinted',
      'outlet',
      'sport',
      'sports',
    ],
    phrases: ['h&m', 'c&a', 'p&c', 'second hand', 'pull bear', 'peek cloppenburg'],
    contains: [
      'kleidung',
      'klamotten',
      'clothing',
      'clothes',
      'apparel',
      'fashion',
      'zalando',
      'deichmann',
      'uniqlo',
      'primark',
      'breuninger',
      'ernsting',
      'decathlon',
      'intersport',
      'boutique',
      'schuhe',
      'schuhladen',
      'secondhand',
      'sportgeschaft',
      'sportgeschaeft',
      'sportbedarf',
      'unterwasche',
      'unterwaesche',
    ],
  },
  {
    icon: 'stationery',
    words: [
      'buro',
      'buero',
      'office',
      'schule',
      'school',
      'buch',
      'bucher',
      'buecher',
      'books',
      'book',
      'papier',
      'paper',
      'stifte',
      'pens',
      'craft',
      'crafts',
    ],
    phrases: ['office supply', 'office supplies'],
    contains: [
      'schreibwar',
      'stationer',
      'burobedarf',
      'buerobedarf',
      'papierwar',
      'schulbedarf',
      'schulsachen',
      'buchhandlung',
      'bucherei',
      'buecherei',
      'thalia',
      'hugendubel',
      'osiander',
      'mayersche',
      'mcpaper',
      'staples',
      'bookstore',
      'bookshop',
      'bastel',
      'kunstlerbedarf',
      'kuenstlerbedarf',
      'boesner',
      'gerstaecker',
    ],
  },
  {
    icon: 'baby',
    words: ['kinder', 'kita', 'kids'],
    contains: [
      'baby',
      'windel',
      'diaper',
      'kinderwagen',
      'kindergarten',
      'schnuller',
      'nappy',
      'nappies',
      'toddler',
      'infant',
      'schwangerschaft',
      'maternity',
    ],
  },
  {
    icon: 'garden',
    words: ['plant', 'plants', 'seeds', 'samen', 'blume'],
    contains: [
      'garten',
      'gartner',
      'gaertner',
      'dehner',
      'blumen',
      'florist',
      'pflanz',
      'balkon',
      'garden',
      'flower',
    ],
  },
  {
    icon: 'supermarket',
    words: [
      'rewe',
      'edeka',
      'aldi',
      'lidl',
      'penny',
      'netto',
      'tegut',
      'globus',
      'norma',
      'spar',
      'hofer',
      'billa',
      'migros',
      'coop',
      'tesco',
      'asda',
      'walmart',
      'costco',
      'carrefour',
      'auchan',
    ],
    phrases: ['trader joe', 'trader joes'],
    contains: [
      'supermarkt',
      'supermarket',
      'grocer',
      'wocheneinkauf',
      'lebensmittel',
      'discounter',
      'kaufland',
      'nahkauf',
      'marktkauf',
      'famila',
      'sainsbury',
      'waitrose',
    ],
  },
  {
    icon: 'online',
    words: [
      'ebay',
      'otto',
      'etsy',
      'temu',
      'shein',
      'flink',
      'wolt',
      'order',
      'orders',
      'paket',
      'pakete',
      'parcel',
    ],
    contains: [
      'online',
      'bestell',
      'amazon',
      'aliexpress',
      'galaxus',
      'digitec',
      'lieferdienst',
      'lieferung',
      'lieferando',
      'versand',
      'webshop',
      'internet',
      'delivery',
      'shipping',
      'knuspr',
      'picnic',
    ],
  },
  {
    icon: 'market',
    words: ['markt', 'market', 'obst', 'gemuse', 'gemuese', 'produce', 'veggies'],
    phrases: ['farmers market', 'farmer market'],
    contains: [
      'wochenmarkt',
      'bauernmarkt',
      'gemusemarkt',
      'gemuesemarkt',
      'obstmarkt',
      'markthalle',
      'marktstand',
      'gemusehandler',
      'gemuesehaendler',
      'obststand',
      'greenmarket',
      'hofladen',
    ],
    suffixes: ['markt'],
  },
]

function normalizeForSuggestion(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/['’]/g, '')
    .toLowerCase()
}

function matchesRule(
  rule: SuggestionRule,
  normalized: string,
  padded: string,
  tokens: string[],
  tokenSet: Set<string>,
): boolean {
  if (rule.words?.some((word) => tokenSet.has(word))) return true
  if (rule.phrases?.some((phrase) => padded.includes(` ${phrase} `))) return true
  if (rule.contains?.some((needle) => normalized.includes(needle))) return true
  if (rule.suffixes?.some((suffix) => tokens.some((token) => token.endsWith(suffix)))) return true
  return false
}

/**
 * Suggests a fitting icon from a list name, or null when nothing specific matches.
 * Handles case, German umlauts/ß, apostrophes and compound words.
 */
export function suggestListIcon(name: string): ListIcon | null {
  const normalized = normalizeForSuggestion(name).trim()
  if (!normalized) return null

  const tokens = normalized.match(/[a-z0-9]+/g) ?? []
  if (tokens.length === 0) return null

  const tokenSet = new Set(tokens)
  // Keep "&" inside tokens so brand names like "H&M" or "C&A" match on word boundaries.
  const padded = ` ${normalized.replace(/[^a-z0-9&]+/g, ' ').trim()} `

  for (const rule of ICON_SUGGESTION_RULES) {
    if (matchesRule(rule, normalized, padded, tokens, tokenSet)) return rule.icon
  }
  return null
}
