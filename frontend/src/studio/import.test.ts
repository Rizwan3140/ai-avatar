import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importMessage } from './import.ts'

/**
 * The one thing the Products/Documents split could silently lose: a file
 * uploaded on one screen landing on the other without saying so.
 */

const file = (products: number, passages: number, source = 'catalog.csv') => ({
  source,
  products,
  passages,
})

test('a pure catalog reports its count and points nowhere else', () => {
  const message = importMessage(file(12, 0), 'products')
  assert.equal(message.text, 'catalog.csv: 12 products indexed.')
  assert.equal(message.screen, undefined)
})

test('a pure document reports its count and points nowhere else', () => {
  const message = importMessage(file(0, 3, 'returns.pdf'), 'documents')
  assert.equal(message.text, 'returns.pdf: 3 passages indexed.')
  assert.equal(message.screen, undefined)
})

test('a file that lands entirely on the other screen says where it went', () => {
  // The failure this guards: uploading a brochure on Products and being told
  // nothing happened, when three passages were in fact indexed elsewhere.
  const message = importMessage(file(0, 3, 'brochure.pdf'), 'products')
  assert.match(message.text, /no products in this one/)
  assert.match(message.text, /3 passages went to/)
  assert.equal(message.screen, 'documents')
})

test('the same, mirrored, from the documents screen', () => {
  const message = importMessage(file(4, 0, 'export.csv'), 'documents')
  assert.match(message.text, /no passages in this one/)
  assert.match(message.text, /4 products went to/)
  assert.equal(message.screen, 'products')
})

test('a brochure that yields both reports both, and links to the other', () => {
  const message = importMessage(file(12, 3, 'brochure.docx'), 'products')
  assert.match(message.text, /12 products indexed/)
  assert.match(message.text, /3 passages went to/)
  assert.equal(message.screen, 'documents')
})

test('and mirrored again', () => {
  const message = importMessage(file(12, 3, 'brochure.docx'), 'documents')
  assert.match(message.text, /3 passages indexed/)
  assert.match(message.text, /12 products went to/)
  assert.equal(message.screen, 'products')
})

test('an empty result explains what each format becomes', () => {
  // Unreachable through the API today — the route answers 422 first — so this
  // asserts the guard exists rather than a user-visible behaviour.
  const message = importMessage(file(0, 0, 'notes.rtf'), 'products')
  assert.match(message.text, /nothing was indexed/)
  assert.equal(message.screen, undefined)
})
