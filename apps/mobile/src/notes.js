// Notes and clips, synced as records in the 'notes' collection.
// data: { text, url, title, space, createdAt, editedAt }

import * as Crypto from 'expo-crypto'
import { putRecord, liveRecords, useStore, getState } from './store'

const all = () => liveRecords('notes').filter((r) => r.data)
const asItem = (r) => ({ id: r.id, ...r.data, space: r.data.space || 'personal' })

/** Save a note (or a clip of selected text from a page). Returns its id. */
export function addNote({ text = '', url = '', title = '', space } = {}) {
  const body = String(text || '').trim().slice(0, 20000)
  if (!body && !url) return null
  const id = Crypto.randomUUID()
  putRecord('notes', id, {
    text: body,
    url: /^https?:/i.test(url) ? url : '',
    title: String(title || '').slice(0, 300),
    space: space || getState().activeSpace || 'personal',
    createdAt: Date.now(),
    editedAt: Date.now(),
  })
  return id
}

export function updateNote(id, change) {
  const r = all().find((x) => x.id === id)
  if (r) putRecord('notes', id, { ...r.data, ...change, text: String(change.text ?? r.data.text).slice(0, 20000), editedAt: Date.now() })
}

export function removeNote(id) {
  putRecord('notes', id, null, { deleted: true })
}

/** React hook: notes, newest edit first; pass a Space id to filter, or null for all. */
export function useNotes(space = null) {
  useStore((s) => s.records.notes)
  return all()
    .map(asItem)
    .filter((n) => !space || n.space === space)
    .sort((a, b) => b.editedAt - a.editedAt)
}

/** Page script: posts { __bitClip: { text, url, title } } with the current selection (or nothing selected). */
export const CLIP_JS = `(function(){
  try {
    var sel = String(window.getSelection ? window.getSelection() : '').trim().slice(0, 20000);
    window.ReactNativeWebView.postMessage(JSON.stringify({ __bitClip: { text: sel, url: location.href, title: document.title } }));
  } catch (e) {}
})(); true;`
