using MusicTheory.API.Services.Transcription;

namespace MusicTheory.API.Tests;

/// <summary>
/// The library's own unit tests for <c>toMidi.ts</c>, ported alongside the code
/// they cover.
/// </summary>
/// <remarks>
/// <para>
/// These are not a substitute for <see cref="BasicPitchNotesDifferentialTests"/>
/// — every one of them can pass while the decoder returns different notes,
/// because none of them runs the decoder. They earn their place by failing
/// <em>legibly</em>: a differential failure says "note 41 of 150 has the wrong
/// start frame", and a helper with the wrong tie-breaking rule is a much
/// shorter walk from "argMax keeps the wrong index of a tie".
/// </para>
/// <para>
/// Two of the library's twelve are not here. <c>meanStdDev</c> is tested there
/// against a TensorFlow normal sample, which would mean a tensor library in
/// this project to assert that 2 is roughly 2; a deterministic sequence with a
/// known answer is used instead. <c>generateFileData</c> is not ported at all —
/// nothing server-side emits MIDI files, and the client does not use it either.
/// </para>
/// </remarks>
public class BasicPitchNotesTests
{
    [Fact]
    public void HzToMidi_understands_what_440Hz_is()
    {
        Assert.Equal(69.0, BasicPitchGrid.HzToMidi(440));
    }

    [Fact]
    public void MidiToHz_understands_what_69_is()
    {
        Assert.Equal(440.0, BasicPitchGrid.MidiToHz(69));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 0.0116)]
    [InlineData(2, 0.0232)]
    public void ModelFrameToTime_returns_correct_times(int frame, double expected)
    {
        Assert.Equal(expected, BasicPitchGrid.ModelFrameToTime(frame), 4);
    }

    /// <summary>
    /// The one deliberate signature change among the helpers: the original
    /// returns <c>null</c> for an empty row and this returns -1, because the
    /// alternative is a nullable int threaded through the hot loop for a case
    /// that cannot arise. The behaviour that matters is preserved at the only
    /// call site that can see it, which
    /// <see cref="AddPitchBends_treats_an_empty_window_as_the_original_treats_null"/>
    /// covers.
    /// </summary>
    [Fact]
    public void ArgMax_reports_an_empty_row_as_minus_one()
    {
        Assert.Equal(-1, BasicPitchMath.ArgMax([]));
    }

    [Fact]
    public void ArgMax_finds_the_maximum()
    {
        Assert.Equal(1, BasicPitchMath.ArgMax([1, 2, -1]));
    }

    /// <summary>
    /// Not in the library's suite, and the single most important line in this
    /// file. A run of equal values is what a zeroed band of
    /// <c>remainingEnergy</c> looks like, so which end of a tie wins decides
    /// real notes in the melodia pass.
    /// </summary>
    [Fact]
    public void ArgMax_breaks_ties_towards_the_later_index()
    {
        Assert.Equal(3, BasicPitchMath.ArgMax([5, 5, 1, 5]));
    }

    [Fact]
    public void ArgMaxAxis1_returns_the_correct_indices()
    {
        Assert.Equal(
            [2, 2],
            BasicPitchMath.ArgMaxAxis1([[10, 11, 12], [13, 14, 15]]));
    }

    [Fact]
    public void WhereGreaterThanAxis1_returns_all_elements_greater_than_threshold()
    {
        var (rows, cols) = BasicPitchMath.WhereGreaterThanAxis1(
            [[1, 2], [3, 4]],
            1);

        Assert.Equal([0, 1, 1], rows);
        Assert.Equal([1, 0, 1], cols);
    }

    [Fact]
    public void MeanStdDev_returns_the_mean_and_sample_standard_deviation()
    {
        // 1..10, whose mean is 5.5 and whose sample standard deviation is
        // sqrt(55/6). Deterministic, so it asserts the formula rather than
        // asserting that a random sample looks roughly like its parameters.
        var (mean, std) = BasicPitchMath.MeanStdDev([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);

        Assert.Equal(5.5, mean, 12);
        Assert.Equal(Math.Sqrt(55.0 / 6.0), std, 12);
    }

    [Fact]
    public void GlobalMax_calculates_the_global_max()
    {
        Assert.Equal(
            100.0,
            BasicPitchMath.GlobalMax(
            [
                [1, 2, 3, 4, 100, 5, 6, 7, 8, 9, 10],
                [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
            ]));
    }

    /// <summary>
    /// The zero floor, which is the original's <c>reduce</c> seed rather than
    /// anything anyone chose. Not in the library's suite; documented here so
    /// that a future tidy-up of <see cref="BasicPitchMath.GlobalMax"/> breaks a
    /// test rather than the melodia loop's guard.
    /// </summary>
    [Fact]
    public void GlobalMax_floors_at_zero_for_an_all_negative_matrix()
    {
        Assert.Equal(0.0, BasicPitchMath.GlobalMax([[-1, -2], [-3, -4]]));
    }

    [Fact]
    public void Min3dForAxis0_calculates_the_min()
    {
        var result = BasicPitchMath.Min3dForAxis0(
        [
            [[-5, 2], [25, -4]],
            [[-1, 29], [50, -100]],
            [[0, 0], [75, 0]]
        ]);

        Assert.Equal([-5, 0], result[0]);
        Assert.Equal([25, -100], result[1]);
    }

    [Fact]
    public void Max3dForAxis0_calculates_the_max()
    {
        var result = BasicPitchMath.Max3dForAxis0(
        [
            [[-5, -2], [25, -400]],
            [[-6, -29], [-50, -100]],
            [[-100, 0], [-75, -500]]
        ]);

        Assert.Equal([-5, 0], result[0]);
        Assert.Equal([25, -100], result[1]);
    }

    [Fact]
    public void ArgRelMax_returns_maxima()
    {
        var result = BasicPitchMath.ArgRelMax(
        [
            [0, 0],
            [0, 0],
            [0, 0],
            [2, 2],
            [1, 1],
            [0, 0],
            [-1, -1],
            [-2, -3]
        ]);

        Assert.Equal([(3, 0), (3, 1)], result);
    }

    [Fact]
    public void Gaussian_creates_a_gaussian()
    {
        double[] expected =
        [
            0.53109599, 0.68194075, 0.82257756, 0.93210249, 0.99221794,
            0.99221794, 0.93210249, 0.82257756, 0.68194075, 0.53109599
        ];

        var actual = BasicPitchMath.Gaussian(10, 4);

        Assert.Equal(expected.Length, actual.Length);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i], actual[i], 1e-4);
        }
    }

    [Fact]
    public void MidiPitchToContourBin_converts_69()
    {
        Assert.Equal(144.0, BasicPitchGrid.MidiPitchToContourBin(69));
    }

    [Fact]
    public void ConstrainFrequency_clears_the_bands_outside_the_bounds()
    {
        var onsets = new[] { Filled(88, 1.0) };
        var frames = new[] { Filled(88, 1.0) };

        // A4 is MIDI 69, bin 48; A2 is MIDI 45, bin 24.
        BasicPitchOnsets.ConstrainFrequency(onsets, frames, 440.0, 110.0);

        Assert.Equal(0.0, frames[0][23]);
        Assert.Equal(1.0, frames[0][24]);
        Assert.Equal(1.0, frames[0][47]);
        Assert.Equal(0.0, frames[0][48]);
        Assert.Equal(0.0, onsets[0][87]);
    }

    /// <summary>
    /// The one place the port refuses input the original accepts. JavaScript's
    /// <c>fill</c> reads a negative index as relative to the end of the row, so
    /// a bound below the model's lowest bin clears most of a row there instead
    /// of a sliver. Nothing calls this with bounds at all; the exception is so
    /// that whoever first does gets told rather than surprised.
    /// </summary>
    [Fact]
    public void ConstrainFrequency_refuses_a_bound_below_the_lowest_bin()
    {
        var onsets = new[] { Filled(88, 1.0) };
        var frames = new[] { Filled(88, 1.0) };

        Assert.Throws<ArgumentOutOfRangeException>(
            () => BasicPitchOnsets.ConstrainFrequency(onsets, frames, null, 20.0));
    }

    private static double[] Filled(int length, double value)
    {
        var row = new double[length];
        Array.Fill(row, value);
        return row;
    }

    /// <summary>
    /// The cached row index against the naive scan it replaces, under the kind
    /// of mutation the melodia loop performs.
    /// </summary>
    /// <remarks>
    /// The differential suite already proves the pair agree on six decoded
    /// cases, which is the assertion that matters. This one is cheaper to read
    /// when it fails: it isolates the cache from everything else in the loop,
    /// and it hits ties deliberately — a matrix of small integers has plenty,
    /// and a tie is where a cache that remembered the wrong column would show.
    /// </remarks>
    [Fact]
    public void Cached_index_agrees_with_the_naive_scan_under_mutation()
    {
        var random = new Random(20260907);
        var matrix = new double[60][];
        for (var r = 0; r < matrix.Length; r++)
        {
            matrix[r] = new double[12];
            for (var c = 0; c < matrix[r].Length; c++)
            {
                // Small integers, so ties are common rather than hypothetical.
                matrix[r][c] = random.Next(0, 5);
            }
        }

        var index = new BasicPitchMath.RowMaxIndex(matrix);

        for (var step = 0; step < 400; step++)
        {
            Assert.Equal(BasicPitchMath.MaxCell(matrix), index.MaxCell());

            var row = random.Next(matrix.Length);
            matrix[row][random.Next(matrix[row].Length)] = random.Next(0, 5);
            index.Invalidate(row);
        }

        Assert.Equal(BasicPitchMath.MaxCell(matrix), index.MaxCell());
    }

    /// <summary>
    /// The original reads the argmax of an empty window as <c>null</c> and then
    /// subtracts the window shift from it, and JavaScript coerces that
    /// <c>null</c> to 0. The port says 0 out loud. This pins the equivalence at
    /// the only place it is observable: a note pitched off the end of the
    /// contour grid, where the window has no columns left.
    /// </summary>
    [Fact]
    public void AddPitchBends_treats_an_empty_window_as_the_original_treats_null()
    {
        // 264 contour bins is the whole grid; a pitch whose nominal bin sits
        // past it leaves freqStartIdx beyond every column in the row.
        var contours = new double[4][];
        for (var t = 0; t < contours.Length; t++)
        {
            contours[t] = new double[264];
        }

        var note = new NoteEvent
        {
            StartFrame = 0,
            DurationFrames = 4,
            PitchMidi = 130, // contour bin 327, well past the grid
            Amplitude = 0.5
        };

        var result = BasicPitchBends.AddPitchBendsToNoteEvents(contours, [note]);

        Assert.Single(result);
        Assert.NotNull(result[0].PitchBends);
        Assert.Equal(4, result[0].PitchBends!.Count);
        Assert.All(result[0].PitchBends!, bend => Assert.Equal(-25, bend));
    }

    /// <summary>
    /// A note that outlives the posteriorgram gets the frames that exist and no
    /// exception, because the original's slice quietly returns short. The model
    /// output is trimmed to the audio and a note is not, so this happens on
    /// nearly every file at the last note.
    /// </summary>
    [Fact]
    public void AddPitchBends_clamps_a_note_running_past_the_end_of_the_contours()
    {
        var contours = new double[3][];
        for (var t = 0; t < contours.Length; t++)
        {
            contours[t] = new double[264];
        }

        var note = new NoteEvent
        {
            StartFrame = 1,
            DurationFrames = 40,
            PitchMidi = 45,
            Amplitude = 0.5
        };

        var result = BasicPitchBends.AddPitchBendsToNoteEvents(contours, [note]);

        Assert.Equal(2, result[0].PitchBends!.Count);
    }

    /// <summary>
    /// The window-overlap correction is a step function of the frame index, so
    /// a note that straddles a window boundary is shorter in seconds than its
    /// frame count implies. Converting the duration directly instead of
    /// converting both ends would miss it.
    /// </summary>
    [Fact]
    public void NoteFramesToTime_subtracts_the_window_offset_across_a_boundary()
    {
        var straddling = new NoteEvent
        {
            StartFrame = 170,
            DurationFrames = 10, // 170 -> 180, across the boundary at 172
            PitchMidi = 40,
            Amplitude = 0.5
        };

        var within = new NoteEvent
        {
            StartFrame = 100,
            DurationFrames = 10,
            PitchMidi = 40,
            Amplitude = 0.5
        };

        var times = BasicPitchNotes.NoteFramesToTime([straddling, within]);

        Assert.True(
            times[0].DurationSeconds < times[1].DurationSeconds,
            $"straddling note {times[0].DurationSeconds}s should be shorter than "
            + $"the equal-length note within one window at {times[1].DurationSeconds}s");
    }
}
