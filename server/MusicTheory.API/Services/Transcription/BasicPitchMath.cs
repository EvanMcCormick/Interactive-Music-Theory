namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// The array operations <c>toMidi.ts</c> reimplements from numpy and scipy,
/// plus the row-max index that replaces the melodia loop's rescanning.
/// </summary>
/// <remarks>
/// This is the <c>PORTED NUMPY FUNCTIONS</c> section of <c>toMidi.ts</c>,
/// transliterated. Several of these have tie-breaking or seeding behaviour that
/// is surprising and load-bearing — <see cref="ArgMax"/> above all — and each
/// says so at its own docblock rather than here. See
/// <see cref="BasicPitchNotes"/> for why the port is a transliteration.
/// </remarks>
internal static class BasicPitchMath
{
    // ----- ported numpy -----

    /// <summary>
    /// Index of the largest element, or -1 for an empty row.
    /// </summary>
    /// <remarks>
    /// <b>Ties take the later index</b>, which is not what "argmax" usually means
    /// and is not what numpy does. It falls out of the original's <c>reduce</c>
    /// seeding at -1 and advancing on <c>arr[max] greater than current</c> rather
    /// than greater-or-equal. Reproduced deliberately: a run of equal activations
    /// is exactly what a zeroed band of <c>remainingEnergy</c> looks like, so this
    /// rule decides real notes, not just hypothetical ones.
    /// </remarks>
    internal static int ArgMax(double[] row)
    {
        if (row.Length == 0)
        {
            return -1;
        }

        var maxIndex = 0;
        for (var i = 1; i < row.Length; i++)
        {
            // Negated greater-than rather than less-or-equal, so that a NaN
            // advances the index the way the original's comparison does.
            if (!(row[maxIndex] > row[i]))
            {
                maxIndex = i;
            }
        }

        return maxIndex;
    }

    /// <summary><see cref="ArgMax"/> per row.</summary>
    internal static int[] ArgMaxAxis1(IReadOnlyList<double[]> array)
    {
        var result = new int[array.Count];
        for (var i = 0; i < array.Count; i++)
        {
            result[i] = ArgMax(array[i]);
        }

        return result;
    }

    /// <summary>
    /// Row and column indices of every element strictly greater than
    /// <paramref name="threshold"/>, in row-major order.
    /// </summary>
    internal static (List<int> Rows, List<int> Cols) WhereGreaterThanAxis1(
        double[][] array,
        double threshold)
    {
        var rows = new List<int>();
        var cols = new List<int>();

        for (var i = 0; i < array.Length; i++)
        {
            for (var j = 0; j < array[i].Length; j++)
            {
                if (array[i][j] > threshold)
                {
                    rows.Add(i);
                    cols.Add(j);
                }
            }
        }

        return (rows, cols);
    }

    /// <summary>Mean and sample standard deviation over every element.</summary>
    internal static (double Mean, double Std) MeanStdDev(double[][] array)
    {
        double sum = 0, sumSquared = 0;
        var count = 0;

        foreach (var row in array)
        {
            foreach (var value in row)
            {
                sum += value;
                sumSquared += value * value;
                count++;
            }
        }

        var mean = sum / count;
        var std = Math.Sqrt(1.0 / (count - 1) * (sumSquared - sum * sum / count));
        return (mean, std);
    }

    /// <summary>
    /// Largest element, or 0 if every element is smaller than that.
    /// </summary>
    /// <remarks>
    /// The floor at zero is the original's <c>reduce</c> seed and is kept because
    /// it is what the melodia loop's guard actually tests. It never bites on real
    /// input — activations are non-negative — but reproducing it costs one
    /// <c>Math.Max</c> and removing it would be an unforced difference.
    /// </remarks>
    internal static double GlobalMax(double[][] array)
    {
        var max = 0.0;
        foreach (var row in array)
        {
            foreach (var value in row)
            {
                max = Math.Max(max, value);
            }
        }

        return max;
    }

    /// <summary>Elementwise minimum across the outer axis. <c>np.min(axis=0)</c>.</summary>
    internal static double[][] Min3dForAxis0(IReadOnlyList<double[][]> array)
    {
        var result = array[0].Select(row => (double[])row.Clone()).ToArray();

        for (var x = 1; x < array.Count; x++)
        {
            for (var y = 0; y < result.Length; y++)
            {
                for (var z = 0; z < result[y].Length; z++)
                {
                    result[y][z] = Math.Min(result[y][z], array[x][y][z]);
                }
            }
        }

        return result;
    }

    /// <summary>Elementwise maximum across the outer axis. <c>np.max(axis=0)</c>.</summary>
    internal static double[][] Max3dForAxis0(IReadOnlyList<double[][]> array)
    {
        var result = array[0].Select(row => (double[])row.Clone()).ToArray();

        for (var x = 1; x < array.Count; x++)
        {
            for (var y = 0; y < result.Length; y++)
            {
                for (var z = 0; z < result[y].Length; z++)
                {
                    result[y][z] = Math.Max(result[y][z], array[x][y][z]);
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Relative maxima down each column, edges clipped.
    /// <c>scipy.signal.argrelmax</c>, in column-major result order.
    /// </summary>
    /// <remarks>
    /// A single-row input reports every cell as a maximum, because there is
    /// nothing to compare against and the flag starts true. The original does the
    /// same and the decoder never sees an input that short.
    /// </remarks>
    internal static List<(int Row, int Col)> ArgRelMax(double[][] array, int order = 1)
    {
        var result = new List<(int Row, int Col)>();
        if (array.Length == 0)
        {
            return result;
        }

        for (var col = 0; col < array[0].Length; col++)
        {
            for (var row = 0; row < array.Length; row++)
            {
                var isRelMax = true;

                for (var comparisonRow = Math.Max(0, row - order);
                     isRelMax && comparisonRow <= Math.Min(array.Length - 1, row + order);
                     comparisonRow++)
                {
                    if (comparisonRow != row)
                    {
                        isRelMax = array[row][col] > array[comparisonRow][col];
                    }
                }

                if (isRelMax)
                {
                    result.Add((row, col));
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Coordinates and value of the largest cell, under the original's
    /// tie-breaking: the <b>first</b> row that attains the maximum, and within
    /// that row the <b>last</b> column that attains it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The original spends two full passes over the matrix per melodia iteration
    /// — <c>globalMax</c> for the loop guard, then a <c>reduce</c> for the
    /// coordinate — and on a four-minute stem that matrix is two million cells.
    /// This does both in one pass, which is where most of the speed comes from
    /// and the only change that needed an argument that it is safe.
    /// </para>
    /// <para>
    /// It is the same answer, not an approximation. The row rule is preserved by
    /// advancing only on a strict greater-than and seeding from cell [0][0],
    /// which is what the original's <c>reduce</c> seeds its accumulator with; the
    /// column rule is <see cref="ArgMax"/>'s, unchanged. The returned value is
    /// floored at zero so it can stand in for <see cref="GlobalMax"/> in the
    /// guard.
    /// </para>
    /// </remarks>
    internal static (int Row, int Col, double Max) MaxCell(double[][] array)
    {
        if (array.Length == 0 || array[0].Length == 0)
        {
            return (0, 0, 0.0);
        }

        var bestRow = 0;
        var bestCol = 0;
        var best = array[0][0];

        for (var row = 0; row < array.Length; row++)
        {
            var col = ArgMax(array[row]);
            if (col < 0)
            {
                continue;
            }

            if (array[row][col] > best)
            {
                bestRow = row;
                bestCol = col;
                best = array[row][col];
            }
        }

        return (bestRow, bestCol, Math.Max(0.0, best));
    }

    /// <summary>
    /// <see cref="MaxCell"/> with each row's answer remembered, so that erasing
    /// a note costs a rescan of the rows it touched rather than of the matrix.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the algorithmic half of the speed-up, and it is the half that
    /// would have been worth doing in TypeScript too. The melodia loop only ever
    /// <em>lowers</em> values, always through <see cref="ClearBand"/> or a single
    /// assignment, and always at rows it can name — so every row it does not
    /// touch still has the maximum it had last time. The original recomputes all
    /// of them anyway: two million cells per iteration for a four-minute stem,
    /// times the eleven hundred iterations it takes to sweep the energy up.
    /// </para>
    /// <para>
    /// Same answer as <see cref="MaxCell"/>, by construction rather than by
    /// coincidence: <c>_max[r]</c> is exactly <c>matrix[r][_argMax[r]]</c>, so
    /// the scan below makes the identical sequence of comparisons in the
    /// identical order, and the first-row-wins and last-column-wins rules are
    /// untouched. <c>Cached_index_agrees_with_the_naive_scan_under_mutation</c>
    /// holds the two against each other; the differential suite holds the whole
    /// decoder against the TypeScript.
    /// </para>
    /// </remarks>
    internal sealed class RowMaxIndex
    {
        private readonly double[][] _matrix;
        private readonly int[] _argMax;
        private readonly double[] _max;

        public RowMaxIndex(double[][] matrix)
        {
            _matrix = matrix;
            _argMax = new int[matrix.Length];
            _max = new double[matrix.Length];

            for (var row = 0; row < matrix.Length; row++)
            {
                Invalidate(row);
            }
        }

        /// <summary>Recomputes one row, after something lowered a value in it.</summary>
        public void Invalidate(int row)
        {
            var col = ArgMax(_matrix[row]);
            _argMax[row] = col;

            // An empty row can never win, which is what the naive scan's
            // `continue` means.
            _max[row] = col < 0 ? double.NegativeInfinity : _matrix[row][col];
        }

        public (int Row, int Col, double Max) MaxCell()
        {
            if (_matrix.Length == 0 || _matrix[0].Length == 0)
            {
                return (0, 0, 0.0);
            }

            var bestRow = 0;
            var bestCol = 0;
            var best = _matrix[0][0];

            for (var row = 0; row < _matrix.Length; row++)
            {
                if (_max[row] > best)
                {
                    bestRow = row;
                    bestCol = _argMax[row];
                    best = _max[row];
                }
            }

            return (bestRow, bestCol, Math.Max(0.0, best));
        }
    }

    /// <summary>
    /// Symmetric gaussian window, normalised to a peak of 1.
    /// <c>scipy.signal.gaussian</c>.
    /// </summary>
    internal static double[] Gaussian(int m, double std)
    {
        var window = new double[Math.Max(0, m)];
        for (var n = 0; n < window.Length; n++)
        {
            var x = n - (m - 1) / 2.0;
            window[n] = Math.Exp(-1.0 * (x * x) / (2.0 * (std * std)));
        }

        return window;
    }
}
