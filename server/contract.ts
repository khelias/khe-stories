// What the app and the request service agree on: the limits of a request, the states it
// passes through and what a notice says. No imports, so the page and the worker take it too.

/** A child's text or idea, in characters. */
export const TEXT_MAX = 4000;
/** A recorded idea, in bytes before base64; at most 60 seconds of it is recorded. */
export const CLIP_MAX = 2 * 1024 * 1024;
export const RECORD_SECONDS = 60;
/** The types Gemini takes a recording as: Safari records MPEG-4 audio, sent as m4a. */
export const CLIP_TYPES = ['audio/m4a', 'audio/webm'] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

/**
 * `committed` the job has written the story, `ready` its text is on the shelf and the reading
 * is coming, `read` the reading is on the shelf too, `silent` the text is and the reading
 * never came.
 */
export type RequestState = 'queued' | 'running' | 'committed' | 'ready' | 'read' | 'silent' | 'failed';

/** What the service worker shows when a push wakes it: `ready` the text, `read` the reading. */
export interface Notice {
  readonly kind: 'ready' | 'read' | 'failed';
  readonly route: string | null;
  readonly title: string | null;
}
