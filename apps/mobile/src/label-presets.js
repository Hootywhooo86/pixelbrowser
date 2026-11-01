// Label printing presets: the paper (4×6 label or letter), orientation and,
// on iPhone, the printer you last used, so labels print in one tap.
//
// Android always shows its print screen (apps can't pick a printer there);
// the PDF is sent as-is, so a 4×6 label PDF prints at 4×6 on a label printer.
// iPhone can print straight to the remembered printer.

import { Platform } from 'react-native'
import { getState, update, useStore } from './store'

export const PAPERS = {
  '4x6': { label: '4×6 LABEL', width: 288, height: 432 }, // points (72/in)
  letter: { label: 'LETTER', width: 612, height: 792 },
}

const DEFAULT = { paper: '4x6', orientation: 'portrait', printerUrl: '', printerName: '' }

export const getPreset = () => ({ ...DEFAULT, ...(getState().labelPreset || {}) })
export const usePreset = () => ({ ...DEFAULT, ...(useStore((s) => s.labelPreset) || {}) })

export function setPreset(change) {
  update((s) => (s.labelPreset = { ...DEFAULT, ...(s.labelPreset || {}), ...change }))
}

/** iPhone: pick a printer to remember. Android: not possible (the print screen asks each time). */
export async function choosePrinter() {
  if (Platform.OS !== 'ios') return null
  const Print = require('expo-print')
  const p = await Print.selectPrinterAsync()
  if (p?.url) setPreset({ printerUrl: p.url, printerName: p.name || '' })
  return p
}

/** Print a PDF file with the saved preset. */
export async function printPdf(uri) {
  const Print = require('expo-print')
  const preset = getPreset()
  const opts = { uri }
  if (Platform.OS === 'ios') {
    opts.orientation = preset.orientation === 'landscape' ? Print.Orientation.landscape : Print.Orientation.portrait
    if (preset.printerUrl) opts.printerUrl = preset.printerUrl
  }
  try {
    await Print.printAsync(opts)
  } catch (e) {
    // A remembered iPhone printer that's gone: forget it and ask.
    if (opts.printerUrl) {
      setPreset({ printerUrl: '', printerName: '' })
      await Print.printAsync({ uri })
    } else throw e
  }
}

/** Short text for the PRINTER chip, e.g. "4×6 LABEL · Zebra". */
export function presetLabel(p = getPreset()) {
  return [PAPERS[p.paper]?.label || p.paper, p.orientation === 'landscape' ? 'LANDSCAPE' : null, p.printerName || null].filter(Boolean).join(' · ')
}
