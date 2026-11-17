// What the service worker shows for the notices a push fetched: one notification per request,
// the newest notice of it. The text notice and the reading notice of one story share a tag,
// so the second replaces the first on screen and still alerts (`renotify`).
import type { Notice } from '../server/contract.ts';
import type { CopyKey } from './copy.ts';

export interface Shown {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly route: string | null;
}

/** "<title>. <rest>", without a second stop after a title that ends in one. */
const sentence = (title: string, rest: string) => (/[.!?…]$/.test(title) ? `${title} ${rest}` : `${title}. ${rest}`);

/** Null for a kind this worker does not know, from a newer service. */
function show(notice: Notice, copy: Readonly<Record<CopyKey, string>>): Shown | null {
  const where = { tag: notice.route ?? notice.kind, route: notice.kind === 'failed' ? null : notice.route };
  const title = notice.title ?? '';
  switch (notice.kind) {
    case 'ready':
      return { ...where, title: copy.noticeReady, body: title ? sentence(title, copy.noticeReadyBody) : copy.noticeReadyBody };
    case 'read':
      return { ...where, title: copy.noticeRead, body: title };
    case 'failed':
      return { ...where, title: copy.noticeFailed, body: copy.noticeFailedBody };
    default:
      return null;
  }
}

/** The notices in the order the service gave them, oldest first; the last of each tag wins. */
export function shownNotices(notices: readonly Notice[], copy: Readonly<Record<CopyKey, string>>): Shown[] {
  const byTag = new Map<string, Shown>();
  for (const notice of notices) {
    const shown = show(notice, copy);
    if (shown) byTag.set(shown.tag, shown);
  }
  return [...byTag.values()];
}
