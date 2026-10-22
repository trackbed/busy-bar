/** An app's preview cannot go into the catalogue; the message says why. */
export class CatalogueError extends Error {
  override readonly name = 'CatalogueError';
}
