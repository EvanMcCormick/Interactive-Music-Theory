import { Plugin, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { songSchema } from '../../../services/song-schema';

/** The hint an empty lyric line shows where the caret is. */
export const LYRIC_PLACEHOLDER = 'Lyrics…';

/**
 * A faint "Lyrics…" on the empty line holding the caret, and nowhere else.
 *
 * **Only there**, rather than on every empty line: a song is full of empty lines - the gap between two verses' halves,
 * a line left for words still to come - and a hint on each would fill the sheet with grey. The one under the caret
 * says where typing goes, which is the only thing a hint is for. It covers a new song too: the editor starts with the
 * caret in the first line of the first section, so an empty song shows the hint there.
 *
 * **The caret's line, not the focused one**: it shows whether or not the sheet has the focus, because the caret is
 * still where typing will resume, and a hint that came and went as the toolbar took the focus would flicker for
 * nothing. A decoration of the line's node - a class and a `data-placeholder` its `::before` prints - so the hint is
 * never text in the document, and the caret sits before it.
 */
export function lyricPlaceholderPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: state => {
        const selection = state.selection;
        if (!(selection instanceof TextSelection) || !selection.empty) return null;
        const $caret = selection.$head;
        const line = $caret.parent;
        if (line.type !== songSchema.nodes.lyricLine || line.content.size > 0) return null;

        const start = $caret.before();
        return DecorationSet.create(state.doc, [
          Decoration.node(start, start + line.nodeSize, {
            class: 'is-placeholder',
            'data-placeholder': LYRIC_PLACEHOLDER
          })
        ]);
      }
    }
  });
}
