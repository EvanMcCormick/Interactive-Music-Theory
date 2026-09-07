using static MusicTheory.API.Services.Transcription.BasicPitchGrid;
using static MusicTheory.API.Services.Transcription.BasicPitchMath;

namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// The second pass over the model's output: reading each decoded note's pitch
/// contour off the third posteriorgram.
/// </summary>
/// <remarks>
/// Separate from <see cref="BasicPitchNotes"/> because it reads a different
/// output of the model and can be skipped entirely — a caller that does not
/// want bends never has to touch the contour matrix, which is the largest of
/// the three at 264 bins to a frame. See <see cref="BasicPitchNotes"/> for why
/// the port is a transliteration.
/// </remarks>
public static class BasicPitchBends
{
    /// <summary>
    /// Attaches a per-frame pitch bend to each note, read off the contour
    /// posteriorgram as the argmax of a gaussian-weighted window around the
    /// note's nominal bin.
    /// </summary>
    /// <remarks>
    /// The gaussian is what stops a strong partial 25 bins away from being read
    /// as an eight-semitone bend: it is a prior that the true contour is near the
    /// nominal pitch, not a filter.
    /// </remarks>
    public static List<NoteEvent> AddPitchBendsToNoteEvents(
        double[][] contours,
        IReadOnlyList<NoteEvent> notes,
        int nBinsTolerance = 25)
    {
        ArgumentNullException.ThrowIfNull(contours);
        ArgumentNullException.ThrowIfNull(notes);

        var windowLength = nBinsTolerance * 2 + 1;
        var freqGaussian = Gaussian(windowLength, 5);
        var result = new List<NoteEvent>(notes.Count);

        foreach (var note in notes)
        {
            var freqIdx = (int)Math.Floor(Math.Round(MidiPitchToContourBin(note.PitchMidi)));
            var freqStartIdx = Math.Max(freqIdx - nBinsTolerance, 0);
            var freqEndIdx = Math.Min(NFreqBinsContours, freqIdx + nBinsTolerance + 1);

            // The window is clipped by the same amount at whichever end runs off
            // the grid, so its length always matches the slice below.
            var gaussianStart = Math.Max(0, nBinsTolerance - freqIdx);

            // A note can run past the end of the posteriorgram — the model's
            // output is trimmed to the audio and a note is not — and the
            // original's slice quietly returns the rows that exist.
            var firstFrame = Math.Clamp(note.StartFrame, 0, contours.Length);
            var lastFrame = Math.Clamp(
                note.StartFrame + note.DurationFrames,
                firstFrame,
                contours.Length);

            var pbShift = nBinsTolerance - gaussianStart;
            var bends = new int[lastFrame - firstFrame];

            for (var f = firstFrame; f < lastFrame; f++)
            {
                var row = contours[f];
                var width = Math.Max(0, Math.Min(freqEndIdx, row.Length) - freqStartIdx);
                var windowed = new double[width];
                for (var c = 0; c < width; c++)
                {
                    windowed[c] = row[freqStartIdx + c] * freqGaussian[gaussianStart + c];
                }

                // An empty window would make the original's argmax null, which
                // its arithmetic then coerces to 0. Same answer, said out loud.
                var argMax = ArgMax(windowed);
                bends[f - firstFrame] = (argMax < 0 ? 0 : argMax) - pbShift;
            }

            result.Add(note with { PitchBends = bends });
        }

        return result;
    }
}
