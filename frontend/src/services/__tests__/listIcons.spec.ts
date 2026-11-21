import { describe, expect, it } from 'vitest'

import de from '@/i18n/locales/de.json'
import en from '@/i18n/locales/en.json'
import { DEFAULT_LIST_ICON, suggestListIcon } from '@/services/listIcons'
import type { ListIcon } from '@/types/api'

describe('suggestListIcon', () => {
  it.each<[string, ListIcon]>([
    // Supermarket
    ['Supermarkt', 'supermarket'],
    ['Supermarket', 'supermarket'],
    ['Aldi', 'supermarket'],
    ['ALDI Süd', 'supermarket'],
    ['Lidl', 'supermarket'],
    ['Rewe', 'supermarket'],
    ['Edeka', 'supermarket'],
    ['Kaufland', 'supermarket'],
    ['Wocheneinkauf Rewe', 'supermarket'],
    ['Wocheneinkauf', 'supermarket'],
    ['Weekly groceries', 'supermarket'],
    // Market
    ['Wochenmarkt', 'market'],
    ['Bauernmarkt', 'market'],
    ['Markt', 'market'],
    ['Samstagsmarkt', 'market'],
    ["Farmers' market", 'market'],
    ['Obst & Gemüse', 'market'],
    // Bakery
    ['Bäcker', 'bakery'],
    ['Bäckerei', 'bakery'],
    ['Backer', 'bakery'],
    ['Baecker', 'bakery'],
    ['Dorfbäckerei', 'bakery'],
    ['Brötchen holen', 'bakery'],
    ['Bakery', 'bakery'],
    // Butcher
    ['Metzger', 'butcher'],
    ['Metzgerei', 'butcher'],
    ['Fleischer', 'butcher'],
    ['Butcher', 'butcher'],
    // Drinks
    ['Getränke', 'drinks'],
    ['Getraenke', 'drinks'],
    ['Getränkemarkt', 'drinks'],
    ['Trinkgut', 'drinks'],
    ['Flaschenpost', 'drinks'],
    ['Wein & Bier', 'drinks'],
    ['Drinks', 'drinks'],
    // Organic
    ['Bioladen', 'organic'],
    ['Biomarkt', 'organic'],
    ['Bio-Markt', 'organic'],
    ['Bio Supermarkt', 'organic'],
    ['Alnatura', 'organic'],
    ["Denn's", 'organic'],
    ['Organic shop', 'organic'],
    // Drugstore
    ['Drogerie', 'drugstore'],
    ['dm', 'drugstore'],
    ['dm-Markt', 'drugstore'],
    ['Rossmann', 'drugstore'],
    ['Müller', 'drugstore'],
    ['Budni', 'drugstore'],
    ['Drugstore', 'drugstore'],
    // Pharmacy
    ['Apotheke', 'pharmacy'],
    ['Shop Apotheke', 'pharmacy'],
    ['Apotheke am Markt', 'pharmacy'],
    ['Medikamente', 'pharmacy'],
    ['Pharmacy', 'pharmacy'],
    // Baby
    ['Baby', 'baby'],
    ['Windeln', 'baby'],
    ['Kindergarten', 'baby'],
    ['Kita', 'baby'],
    ['Diapers', 'baby'],
    // Pets
    ['Tierbedarf', 'pets'],
    ['Fressnapf', 'pets'],
    ['Zooplus', 'pets'],
    ['Hundefutter', 'pets'],
    ['Katzenstreu', 'pets'],
    ['Pet supplies', 'pets'],
    // Hardware
    ['Baumarkt', 'hardware'],
    ['OBI', 'hardware'],
    ['Hornbach', 'hardware'],
    ['Bauhaus', 'hardware'],
    ['Toom', 'hardware'],
    ['Hagebau', 'hardware'],
    ['Globus Baumarkt', 'hardware'],
    ['Hardware store', 'hardware'],
    // Garden
    ['Gartencenter', 'garden'],
    ['Gärtnerei', 'garden'],
    ['Dehner', 'garden'],
    ['Blumen', 'garden'],
    ['Balkon', 'garden'],
    ['Garden center', 'garden'],
    // Furniture
    ['Möbelhaus', 'furniture'],
    ['Möbel', 'furniture'],
    ['Moebel', 'furniture'],
    ['IKEA', 'furniture'],
    ['XXXLutz', 'furniture'],
    ['Segmüller', 'furniture'],
    ['JYSK', 'furniture'],
    ['Furniture store', 'furniture'],
    // Electronics
    ['Elektronik', 'electronics'],
    ['MediaMarkt', 'electronics'],
    ['Media Markt', 'electronics'],
    ['Saturn', 'electronics'],
    ['Electronics', 'electronics'],
    // Stationery
    ['Schreibwaren', 'stationery'],
    ['Bürobedarf', 'stationery'],
    ['Thalia', 'stationery'],
    ['Buchhandlung', 'stationery'],
    ['Stationery', 'stationery'],
    // Clothing
    ['Kleidung', 'clothing'],
    ['Kinderkleidung', 'clothing'],
    ['Schuhe', 'clothing'],
    ['H&M', 'clothing'],
    ['C&A', 'clothing'],
    ['Zalando', 'clothing'],
    ['Clothing', 'clothing'],
    // Online
    ['Online bestellen', 'online'],
    ['Online-Bestellung', 'online'],
    ['Amazon', 'online'],
    ['eBay', 'online'],
    ['Online order', 'online'],
  ])('suggests %s -> %s', (name, want) => {
    expect(suggestListIcon(name)).toBe(want)
  })

  it.each([
    '',
    '   ',
    'Urlaub',
    'Party',
    'WG',
    'Allgemein',
    'General',
    // Short keywords must not trigger inside unrelated words.
    'Admin',
    'Badminton',
    'Mobil',
    'Tapete',
    'Zoom',
    'Antibiotika',
    'ca. 50 Euro',
  ])('returns null for %j', (name) => {
    expect(suggestListIcon(name)).toBeNull()
  })

  it('matches every localized icon name in German and English except general', () => {
    for (const names of [de.list.icon.names, en.list.icon.names]) {
      for (const [icon, label] of Object.entries(names) as [ListIcon, string][]) {
        expect(suggestListIcon(label)).toBe(icon === DEFAULT_LIST_ICON ? null : icon)
      }
    }
  })
})
