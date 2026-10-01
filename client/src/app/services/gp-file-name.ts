/**
 * What counts as a Guitar Pro file, by its name. Kept apart from `GpFileOpener`, which imports alphaTab at the top, so
 * the gallery can test a dropped file's extension without its route chunk pulling in the alphaTab core and the
 * composer's services.
 */

/**
 * The extensions of a file alphaTab can read as Guitar Pro: one list, so the name test and the Import .gp… picker's
 * `accept` cannot come to disagree about what a Guitar Pro file is.
 */
export const GP_FILE_EXTENSIONS: readonly string[] = ['gp', 'gp3', 'gp4', 'gp5', 'gpx'];

/** `GP_FILE_EXTENSIONS` as a file input's `accept`: `.gp,.gp3,…`. */
export const GP_FILE_ACCEPT = GP_FILE_EXTENSIONS.map(extension => `.${extension}`).join(',');

const GP_FILE = new RegExp(`\\.(${GP_FILE_EXTENSIONS.join('|')})$`, 'i');

/** Whether `fileName` names a Guitar Pro file, by its extension. */
export function isGpFileName(fileName: string): boolean {
  return GP_FILE.test(fileName);
}
