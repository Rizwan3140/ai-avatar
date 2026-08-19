/**
 * What to tell someone after they upload a file.
 *
 * `POST /api/studio/import` decides what a file *is* by its shape rather than by
 * its extension: rows with headers become products, prose becomes searchable
 * passages, and a brochure with a spec table in it becomes both. That is the
 * right behaviour — the person holding the file usually does not know which kind
 * they have — but it means an upload started on one screen can land on the other.
 *
 * So the result is never reported as a bare count. It always says where the file
 * went, and when part of it went elsewhere the caller renders that destination as
 * a button rather than as prose, so it is one click away and can never be silent.
 *
 * Pure, because it is the only branching this split adds and the one behaviour
 * that must not quietly regress.
 */

export type ImportResult = {
  source: string
  products: number
  passages: number
}

export type Screen = 'products' | 'documents'

export type ImportMessage = {
  text: string
  /** Set when part of the upload landed on the other screen. */
  screen?: Screen
}

const OTHER: Record<Screen, Screen> = {
  products: 'documents',
  documents: 'products',
}

/** What each screen calls the thing it holds. */
const NOUN: Record<Screen, string> = {
  products: 'products',
  documents: 'passages',
}

export function importMessage(result: ImportResult, on: Screen): ImportMessage {
  const other = OTHER[on]
  const mine = on === 'products' ? result.products : result.passages
  const theirs = on === 'products' ? result.passages : result.products

  // Unreachable through the current API — the route answers 422 rather than
  // returning two zeroes, so the caller renders an error instead. Handled anyway
  // because a pure function with an unhandled case is a trap for the next caller.
  if (!mine && !theirs) {
    return {
      text:
        `${result.source}: nothing was indexed. A CSV or JSON export becomes ` +
        `products; a PDF, Word or Markdown file becomes passages.`,
    }
  }

  if (!mine) {
    return {
      text: `${result.source}: no ${NOUN[on]} in this one — ${theirs} ${NOUN[other]} went to`,
      screen: other,
    }
  }

  if (!theirs) {
    return { text: `${result.source}: ${mine} ${NOUN[on]} indexed.` }
  }

  // Both. Stated plainly rather than as a warning: a spec table found inside a
  // brochure is the feature working, not a problem to report.
  return {
    text: `${result.source}: ${mine} ${NOUN[on]} indexed, and ${theirs} ${NOUN[other]} went to`,
    screen: other,
  }
}
