using static MusicTheory.API.Services.Transcription.BasicPitchGrid;
using static MusicTheory.API.Services.Transcription.BasicPitchMath;

namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// What happens to the posteriorgrams before the decoder reads them: an
/// optional frequency bound, and the onsets inferred from rises in frame
/// energy.
/// </summary>
/// <remarks>
/// Both are called from <see cref="BasicPitchNotes.OutputToNotesPoly"/> and
/// from nowhere else; they live here because that method is long enough
/// already. See <see cref="BasicPitchNotes"/> for why the port is a
/// transliteration.
/// </remarks>
internal static class BasicPitchOnsets
{
    /// <summary>
    /// Zeroes <paramref name="onsets"/> and <paramref name="frames"/> outside a
    /// frequency band, in place.
    /// </summary>
    /// <remarks>
    /// Never used by this application, and the reason is measured rather than
    /// assumed: constraining the model's range removed exactly one of twenty-six
    /// harmonic partials on the spike's bassline, because a bass's partials sit
    /// inside a bass's range. Suppression happens downstream on the ratio between
    /// a note and the one below it, where it can actually see the difference.
    /// Ported anyway so the signature matches.
    ///
    /// <para>
    /// <b>A bound below 27.5 Hz throws here and does something surprising in
    /// JavaScript.</b> The original passes a bin index straight to
    /// <c>Array.prototype.fill</c>, which reads a negative index as relative to
    /// the end of the row — so a <c>minFreq</c> under the lowest piano key would
    /// not clear a narrow band, it would clear most of one, silently. That is an
    /// accident of <c>fill</c> rather than anything the algorithm wants, and
    /// reproducing an accident faithfully in a function nothing calls is worse
    /// than refusing the input. Whoever wires these parameters up gets an
    /// exception instead of a difference.
    /// </para>
    /// </remarks>
    internal static void ConstrainFrequency(
        double[][] onsets,
        double[][] frames,
        double? maxFreq,
        double? minFreq)
    {
        if (maxFreq is > 0)
        {
            var maxFreqIdx = BinFor(maxFreq.Value, nameof(maxFreq));
            FillFrom(onsets, maxFreqIdx);
            FillFrom(frames, maxFreqIdx);
        }

        if (minFreq is > 0)
        {
            var minFreqIdx = BinFor(minFreq.Value, nameof(minFreq));
            FillUpTo(onsets, minFreqIdx);
            FillUpTo(frames, minFreqIdx);
        }

        static int BinFor(double hz, string parameterName)
        {
            // Truncation, not rounding: `fill` coerces a fractional index with
            // ToIntegerOrInfinity, which truncates toward zero.
            var bin = (int)(HzToMidi(hz) - MidiOffset);
            if (bin < 0)
            {
                throw new ArgumentOutOfRangeException(
                    parameterName,
                    hz,
                    "Frequency bounds below the model's lowest bin (27.5 Hz) are not "
                    + "supported; the TypeScript wraps such an index to the end of the row.");
            }

            return bin;
        }

        static void FillFrom(double[][] array, int start)
        {
            foreach (var row in array)
            {
                for (var i = start; i < row.Length; i++)
                {
                    row[i] = 0;
                }
            }
        }

        static void FillUpTo(double[][] array, int end)
        {
            foreach (var row in array)
            {
                for (var i = 0; i < Math.Min(end, row.Length); i++)
                {
                    row[i] = 0;
                }
            }
        }
    }

    /// <summary>
    /// Adds onsets the onset head missed, inferred from sharp rises in frame
    /// energy, and returns the elementwise maximum of those and the real ones.
    /// </summary>
    /// <remarks>
    /// The original builds this by prepending zero rows and slicing two shifted
    /// copies; the index arithmetic below is that, without the copies. For each
    /// lag n in 1..<paramref name="nDiff"/> the difference is
    /// <c>frames[r] - frames[r-n]</c>, zero above the top edge, and the lags are
    /// then combined by elementwise minimum so that a rise has to be sustained
    /// across every lag to count.
    /// </remarks>
    internal static double[][] GetInferredOnsets(double[][] onsets, double[][] frames, int nDiff = 2)
    {
        var rows = frames.Length;
        var cols = rows == 0 ? 0 : frames[0].Length;

        var diffs = new double[nDiff][][];
        for (var d = 0; d < nDiff; d++)
        {
            var n = d + 1;
            var diff = new double[rows][];
            for (var r = 0; r < rows; r++)
            {
                var row = new double[cols];
                for (var c = 0; c < cols; c++)
                {
                    row[c] = frames[r][c] - (r < n ? 0.0 : frames[r - n][c]);
                }

                diff[r] = row;
            }

            diffs[d] = diff;
        }

        var frameDiff = Min3dForAxis0(diffs);

        for (var r = 0; r < rows; r++)
        {
            // frame_diff[frame_diff < 0] = 0, then frame_diff[:n_diff, :] = 0.
            var zeroRow = r < nDiff;
            for (var c = 0; c < cols; c++)
            {
                frameDiff[r][c] = zeroRow ? 0.0 : Math.Max(frameDiff[r][c], 0.0);
            }
        }

        // Rescale the differences into the onsets' own range so the two are
        // comparable before they are maxed together. A silent input gives
        // frameDiffMax == 0 and this produces NaN, exactly as the original does;
        // the caller has no audio in that case either way.
        var onsetMax = GlobalMax(onsets);
        var frameDiffMax = GlobalMax(frameDiff);
        for (var r = 0; r < rows; r++)
        {
            for (var c = 0; c < cols; c++)
            {
                frameDiff[r][c] = onsetMax * frameDiff[r][c] / frameDiffMax;
            }
        }

        return Max3dForAxis0(new[] { onsets, frameDiff });
    }
}
