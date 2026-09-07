using System.Diagnostics;
using MusicTheory.API.Services.Transcription;
using MusicTheory.API.Tests.Vectors;
using Xunit.Abstractions;

namespace MusicTheory.API.Tests;

/// <summary>
/// The test the port exists to pass: given the same posteriorgrams, the C#
/// decoder returns the same notes as the TypeScript one, exactly.
/// </summary>
/// <remarks>
/// <para>
/// <b>This is not the acceptance criterion, and it is stricter than it.</b> The
/// design's criterion is that the two tiers derive an identical
/// <c>ScoreDoc</c> from a real file, which no assertion here can reach: TF.js
/// is not bit-reproducible between runs near the 0.3 frame threshold, so the
/// two tiers will not even agree on their inputs, let alone their floats. That
/// criterion needs inference on both sides and belongs with
/// <c>real-detections.fixture.ts</c>.
/// </para>
/// <para>
/// What it does buy is the ability to tell those two failures apart. When the
/// end-to-end comparison eventually disagrees about a note, this test says
/// whether the decoder is at fault. If it is passing, the difference came from
/// the model, and the argument moves to whether the derived score changed —
/// which is the question the design says actually matters. Without this, every
/// end-to-end difference is a suspect port.
/// </para>
/// <para>
/// Equality is bit-exact on purpose. There is no reason for two
/// implementations of the same arithmetic on the same doubles to differ by an
/// ulp, and a tolerance would hide the class of bug this is for: a fused loop
/// that reassociates a sum, or a helper that breaks a tie the other way.
/// </para>
/// </remarks>
public class BasicPitchNotesDifferentialTests(ITestOutputHelper output)
{
    public static TheoryData<string> CaseNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in BasicPitchVectors.File_.Cases.Select(c => c.Name))
        {
            data.Add(name);
        }

        return data;
    }

    /// <summary>
    /// Runs before any note is compared: if the two generators have drifted
    /// apart, every downstream failure is noise.
    /// </summary>
    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Generated_input_is_bit_identical_to_the_TypeScript_generator(string name)
    {
        var (expected, frames, onsets, contours) = Load(name);

        Assert.Equal(expected.InputHash.Frames, BasicPitchVectors.HashMatrix(frames));
        Assert.Equal(expected.InputHash.Onsets, BasicPitchVectors.HashMatrix(onsets));
        Assert.Equal(expected.InputHash.Contours, BasicPitchVectors.HashMatrix(contours));
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Decoder_returns_the_notes_the_TypeScript_returns(string name)
    {
        var (expected, frames, onsets, contours) = Load(name);

        Assert.Equal(expected.InputHash.Frames, BasicPitchVectors.HashMatrix(frames));

        var notes = BasicPitchNotes.OutputToNotesPoly(frames, onsets);
        var withBends = BasicPitchBends.AddPitchBendsToNoteEvents(contours, notes);
        var timed = BasicPitchNotes.NoteFramesToTime(withBends);

        // Compared in the order the decoder returns them, which is neither
        // sorted nor meaningful — and is exactly why it is worth asserting. Two
        // implementations that agree on the multiset but not the order have
        // diverged inside the melodia loop.
        Assert.Equal(expected.Notes.Length, withBends.Count);

        for (var i = 0; i < expected.Notes.Length; i++)
        {
            var want = expected.Notes[i];
            var got = withBends[i];
            var where = $"{name} note {i} of {expected.Notes.Length}";

            Assert.True(
                want.StartFrame == got.StartFrame,
                $"{where}: start frame {got.StartFrame}, expected {want.StartFrame}");
            Assert.True(
                want.DurationFrames == got.DurationFrames,
                $"{where}: duration {got.DurationFrames} frames, expected {want.DurationFrames}");
            Assert.True(
                want.PitchMidi == got.PitchMidi,
                $"{where}: pitch {got.PitchMidi}, expected {want.PitchMidi}");
            Assert.True(
                want.Amplitude.Equals(got.Amplitude),
                $"{where}: amplitude {got.Amplitude:R}, expected {want.Amplitude:R}");

            Assert.Equal(want.PitchBends, got.PitchBends);

            Assert.True(
                want.StartTimeSeconds.Equals(timed[i].StartTimeSeconds),
                $"{where}: start {timed[i].StartTimeSeconds:R}s, "
                + $"expected {want.StartTimeSeconds:R}s");
            Assert.True(
                want.DurationSeconds.Equals(timed[i].DurationSeconds),
                $"{where}: duration {timed[i].DurationSeconds:R}s, "
                + $"expected {want.DurationSeconds:R}s");
        }
    }

    /// <summary>
    /// The gaussian bend window is the one transcendental in the pipeline, and
    /// <c>Math.Exp</c> is not required to agree to the last bit between V8 and
    /// .NET. It does; this is what will notice if a runtime upgrade changes
    /// that, and a bend read off a differently-weighted window can land a bin —
    /// 33 cents — away from the browser's.
    /// </summary>
    [Fact]
    public void Bend_window_matches_the_TypeScript_gaussian_bit_for_bit()
    {
        var expected = BasicPitchVectors.File_.Gaussian;
        var actual = BasicPitchMath.Gaussian(51, 5);

        Assert.Equal(expected.Length, actual.Length);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.True(
                expected[i].Equals(actual[i]),
                $"gaussian[{i}] is {actual[i]:R}, TypeScript says {expected[i]:R}");
        }
    }

    [Fact]
    public void Ported_scalars_match_the_TypeScript_exactly()
    {
        var scalars = BasicPitchVectors.File_.Scalars;

        Assert.Equal(scalars.HzToMidi440, BasicPitchGrid.HzToMidi(440));
        Assert.Equal(scalars.MidiToHz69, BasicPitchGrid.MidiToHz(69));

        // Includes both sides of the window boundary at 172 and the last frame
        // of a four-minute stem, where the accumulated offset is largest. Pure
        // arithmetic, so exact equality is the right assertion here.
        int[] frames = [0, 1, 171, 172, 173, 344, 1000, 22599];
        for (var i = 0; i < frames.Length; i++)
        {
            Assert.True(
                scalars.ModelFrameToTime[i].Equals(BasicPitchGrid.ModelFrameToTime(frames[i])),
                $"frame {frames[i]}: {BasicPitchGrid.ModelFrameToTime(frames[i]):R}s, "
                + $"TypeScript says {scalars.ModelFrameToTime[i]:R}s");
        }
    }

    /// <summary>
    /// The one measured place where .NET and V8 do not produce the same double,
    /// and the argument for why it cannot reach a note.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>Math.Pow</c> disagrees by an ulp: <c>midiToHz(40)</c> is
    /// 82.406889228217494 here and 82.40688922821748 in the browser, which
    /// carries into a contour bin of 57.000000000000007 against an exact 57.
    /// <c>Math.Log2</c> was the suspect and is not — it agrees on every value
    /// tested.
    /// </para>
    /// <para>
    /// It cannot change a bend, and the reason is structural rather than lucky.
    /// The contour grid is three bins to a semitone and the base frequency is
    /// A0, so the bin for MIDI <c>p</c> is <c>3p - 63</c> — an exact integer for
    /// every pitch the model can emit. The library then rounds. So the question
    /// is not whether the two runtimes agree but whether either lands 0.5 away
    /// from an integer, and the assertion below is that across the whole
    /// 88-key range the worst case is thirteen orders of magnitude short of
    /// that.
    /// </para>
    /// <para>
    /// Asserted rather than reasoned about because the reasoning is only as good
    /// as the constants: change <c>ANNOTATIONS_BASE_FREQUENCY</c> or the bins per
    /// semitone to something that is not a power-of-two ratio and the integers
    /// stop being integers, at which point an ulp is no longer obviously safe.
    /// </para>
    /// </remarks>
    [Fact]
    public void Contour_bins_round_to_the_same_integer_as_the_TypeScript()
    {
        var scalars = BasicPitchVectors.File_.Scalars;
        int[] sampled = [21, 40, 69, 108];

        for (var i = 0; i < sampled.Length; i++)
        {
            Assert.Equal(
                Math.Round(scalars.MidiPitchToContourBin[i]),
                Math.Round(BasicPitchGrid.MidiPitchToContourBin(sampled[i])));
        }

        // Every pitch the 88-key model can report, not just the sampled four.
        var worst = 0.0;
        var worstPitch = 0;
        for (var pitch = 21; pitch <= 108; pitch++)
        {
            var bin = BasicPitchGrid.MidiPitchToContourBin(pitch);
            var drift = Math.Abs(bin - (3 * pitch - 63));
            if (drift > worst)
            {
                worst = drift;
                worstPitch = pitch;
            }
        }

        output.WriteLine($"worst contour-bin drift {worst:R} bins, at MIDI {worstPitch}");
        Assert.True(
            worst < 1e-9,
            $"contour bin for MIDI {worstPitch} drifts {worst:R} from the integer "
            + "3p-63; rounding is no longer safe and the bend window can move a bin");
    }

    /// <summary>
    /// The reason any of this was worth doing, reported rather than asserted.
    /// </summary>
    /// <remarks>
    /// No threshold: a wall-clock assertion on shared CI hardware is a flaky
    /// test, and the number that matters is measured against a real
    /// four-minute stem rather than against synthetic vectors a twentieth of
    /// the length. It prints, and <c>docs/</c> records what it printed.
    /// </remarks>
    [Fact]
    public void Decoder_timing_is_reported_for_the_record()
    {
        foreach (var vectorCase in BasicPitchVectors.File_.Cases)
        {
            var (_, frames, onsets, contours) = Load(vectorCase.Name);

            var stopwatch = Stopwatch.StartNew();
            var notes = BasicPitchNotes.OutputToNotesPoly(frames, onsets);
            BasicPitchBends.AddPitchBendsToNoteEvents(contours, notes);
            stopwatch.Stop();

            output.WriteLine(
                $"{vectorCase.Name,-10} {vectorCase.NFrames,5} frames  "
                + $"{notes.Count,4} notes  {stopwatch.Elapsed.TotalMilliseconds,8:F2} ms");
        }
    }

    private static (
        BasicPitchVectors.VectorCase Expected,
        double[][] Frames,
        double[][] Onsets,
        double[][] Contours) Load(string name)
    {
        var expected = BasicPitchVectors.File_.Cases.Single(c => c.Name == name);
        var (frames, onsets, contours) = BasicPitchVectors.Generate(
            expected.Seed,
            expected.NFrames,
            expected.NPitches,
            expected.NNotes);

        return (expected, frames, onsets, contours);
    }
}
