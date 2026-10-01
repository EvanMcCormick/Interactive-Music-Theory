import { GP_FILE_ACCEPT, GP_FILE_EXTENSIONS, isGpFileName } from './gp-file-name';

describe('gp-file-name', () => {
  it('names every Guitar Pro extension alphaTab reads', () => {
    expect(GP_FILE_EXTENSIONS).toEqual(['gp', 'gp3', 'gp4', 'gp5', 'gpx']);
  });

  it("offers each extension, dotted, as a file input's accept", () => {
    expect(GP_FILE_ACCEPT).toBe('.gp,.gp3,.gp4,.gp5,.gpx');
  });

  describe('isGpFileName', () => {
    it('takes a name ending in each extension, in any case', () => {
      for (const extension of GP_FILE_EXTENSIONS) {
        expect(isGpFileName(`song.${extension}`)).withContext(extension).toBeTrue();
        expect(isGpFileName(`SONG.${extension.toUpperCase()}`)).withContext(extension).toBeTrue();
      }
    });

    it('refuses any other extension, and one that only contains a Guitar Pro extension', () => {
      expect(isGpFileName('song.mid')).toBeFalse();
      expect(isGpFileName('song.gp6')).toBeFalse();
      expect(isGpFileName('song.gp.bak')).toBeFalse();
      expect(isGpFileName('song-gp')).toBeFalse();
      expect(isGpFileName('')).toBeFalse();
    });
  });
});
