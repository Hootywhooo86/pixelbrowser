// Filter lists Bit Shields can use. Each `id` matches a key in the phone
// app's state.shields.lists (regional lists live in state.shields.regional).
// `trusted` lists may use uBlock Origin's trusted-* scriptlets. An entry in
// `urls` may be an array of mirrors, tried in order.

const UBO = 'https://ublockorigin.github.io/uAssets/filters'

export const LISTS = [
  {
    id: 'easylist',
    name: 'EasyList',
    description: 'Blocks most ads on English-language sites.',
    default: true,
    urls: ['https://easylist.to/easylist/easylist.txt'],
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    description: 'Blocks trackers and analytics that follow you around the web.',
    default: true,
    urls: ['https://easylist.to/easylist/easyprivacy.txt'],
  },
  {
    id: 'ublock',
    name: 'uBlock filters',
    description: "uBlock Origin's own ad, privacy and site-repair filters. Needed for YouTube.",
    default: true,
    trusted: true,
    urls: [`${UBO}/filters.txt`, `${UBO}/privacy.txt`, `${UBO}/unbreak.txt`],
  },
  {
    id: 'ublockQuick',
    name: 'uBlock quick fixes',
    description: 'Fast-changing fixes, including the latest YouTube ad workarounds.',
    default: true,
    trusted: true,
    urls: [`${UBO}/quick-fixes.txt`],
  },
  {
    id: 'peterlowe',
    name: "Peter Lowe's ad and tracking server list",
    description: 'A compact list of ad and tracking servers.',
    default: true,
    urls: [
      [
        'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
        'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/peter-lowe/serverlist.txt',
      ],
    ],
  },
  {
    id: 'annoyances',
    name: 'Annoyances',
    description: 'Hides newsletter pop-ups, "get the app" banners and other clutter. Can hide things you want.',
    default: false,
    urls: ['https://secure.fanboy.co.nz/fanboy-annoyance.txt'],
  },
  {
    id: 'cookies',
    name: 'Cookie banners',
    description: 'Hides "we use cookies" pop-ups.',
    default: false,
    urls: ['https://secure.fanboy.co.nz/fanboy-cookiemonster.txt'],
  },
]

export const REGIONAL_LISTS = [
  { id: 'de', name: 'German (EasyList Germany)', urls: ['https://easylist.to/easylistgermany/easylistgermany.txt'] },
  { id: 'fr', name: 'French (Liste FR)', urls: ['https://easylist-downloads.adblockplus.org/liste_fr.txt'] },
  { id: 'es', name: 'Spanish (EasyList Spanish)', urls: ['https://easylist-downloads.adblockplus.org/easylistspanish.txt'] },
  { id: 'it', name: 'Italian (EasyList Italy)', urls: ['https://easylist-downloads.adblockplus.org/easylistitaly.txt'] },
  { id: 'nl', name: 'Dutch (EasyList Dutch)', urls: ['https://easylist-downloads.adblockplus.org/easylistdutch.txt'] },
  { id: 'ru', name: 'Russian (RU AdList)', urls: ['https://easylist-downloads.adblockplus.org/advblock.txt'] },
  { id: 'zh', name: 'Chinese (EasyList China)', urls: ['https://easylist-downloads.adblockplus.org/easylistchina.txt'] },
]

/**
 * uBlock Origin's scriptlet library, as packaged by the Ghostery adblocker
 * project. Downloaded on the device when lists update, never bundled.
 */
export const SCRIPTLETS_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

/** Free phishing and malware host feeds, checked on the device. */
export const PHISHING_FEEDS = [
  { id: 'phishing-army', name: 'Phishing Army', url: 'https://phishing.army/download/phishing_army_blocklist.txt' },
  { id: 'urlhaus', name: 'URLhaus (malware)', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt' },
]

/** The lists turned on by `enabled` (state.shields.lists) plus regional ids. */
export function selectedLists(enabled = {}, regional = []) {
  const picked = LISTS.filter((l) => (enabled[l.id] ?? l.default))
  for (const id of regional) {
    const r = REGIONAL_LISTS.find((x) => x.id === id)
    if (r) picked.push(r)
  }
  return picked
}
