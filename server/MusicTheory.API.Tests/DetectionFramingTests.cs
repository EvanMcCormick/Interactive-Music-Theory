using MusicTheory.API.Services.Transcription;

namespace MusicTheory.API.Tests;

/// <summary>
/// The window layout, against the definition it is a port of.
/// </summary>
/// <remarks>
/// <c>BasicPitchDetectorTests</c> already exercises this end to end and would
/// fail if the framing were wrong — but it would fail as "note 3 is 40 ms
/// late", which is a long walk back to an off-by-one in a window offset. These
/// are the shorter walk.
///
/// <para>
/// The reference is <c>tf.signal.frame(padded, 43844, 36164, true, 0)</c>,
/// written out as loops rather than asserted against magic numbers, so the
/// agreement is a derivation and not a copy of whatever the code happened to
/// produce.
/// </para>
/// </remarks>
public class DetectionFramingTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(1000)]
    [InlineData(DetectionFraming.WindowHop)]
    [InlineData(DetectionFraming.WindowHop + 1)]
    [InlineData(DetectionFraming.WindowSamples)]
    [InlineData(132300)] // six seconds
    [InlineData(5789696)] // the real capture: a 4:22 stem
    public void Window_count_matches_the_definition_of_signal_frame(int sampleCount)
    {
        // tf.signal.frame starts a window at every multiple of the hop that
        // falls inside the padded signal, and zero-fills the last.
        var padded = DetectionFraming.LeadInSamples + sampleCount;
        var expected = 0;
        for (var start = 0; start < padded; start += DetectionFraming.WindowHop)
        {
            expected++;
        }

        Assert.Equal(expected, DetectionFraming.WindowCountFor(sampleCount));
    }

    [Fact]
    public void The_real_captures_window_count_is_the_one_that_was_measured()
    {
        // 161 windows, as `real-detections.fixture.ts` records for the stem it
        // was captured from. A change here that moved this number would move
        // every note in that fixture.
        Assert.Equal(161, DetectionFraming.WindowCountFor(5789696));
    }

    [Fact]
    public void First_window_leads_in_with_silence_then_the_first_sample()
    {
        var audio = Ramp(DetectionFraming.WindowSamples * 3);
        var (framed, count) = DetectionFraming.FrameForModel(audio);

        Assert.True(count >= 1);

        for (var i = 0; i < DetectionFraming.LeadInSamples; i++)
        {
            Assert.Equal(0f, framed[i]);
        }

        Assert.Equal(audio[0], framed[DetectionFraming.LeadInSamples]);
    }

    [Fact]
    public void Every_window_starts_a_hop_further_into_the_audio()
    {
        var audio = Ramp(DetectionFraming.WindowSamples * 4);
        var (framed, count) = DetectionFraming.FrameForModel(audio);

        // Window w covers the padded signal from w * hop. Subtracting the
        // lead-in turns that into an index into the audio, which is negative
        // only for the first window and only for its silent head.
        for (var window = 1; window < count; window++)
        {
            var from = window * DetectionFraming.WindowHop - DetectionFraming.LeadInSamples;
            if (from + DetectionFraming.WindowSamples > audio.Length)
            {
                continue;
            }

            var offset = window * DetectionFraming.WindowSamples;
            for (var i = 0; i < DetectionFraming.WindowSamples; i += 997)
            {
                Assert.Equal(audio[from + i], framed[offset + i]);
            }
        }
    }

    [Fact]
    public void Consecutive_windows_share_exactly_the_overlap()
    {
        var audio = Ramp(DetectionFraming.WindowSamples * 3);
        var (framed, count) = DetectionFraming.FrameForModel(audio);

        Assert.True(count >= 2);

        // The tail of window 0 is the head of window 1, by `WindowHop` samples
        // of offset - which is what makes the overlap trim symmetric.
        for (var i = 0; i < DetectionFraming.OverlapSamples; i += 101)
        {
            var inFirst = DetectionFraming.WindowHop + i;
            Assert.Equal(framed[inFirst], framed[DetectionFraming.WindowSamples + i]);
        }
    }

    [Fact]
    public void The_last_window_is_padded_with_silence_rather_than_wrapped()
    {
        // A length chosen to leave the last window running well off the end.
        var audio = Ramp(DetectionFraming.WindowHop + 5000);
        var (framed, count) = DetectionFraming.FrameForModel(audio);

        var lastStart = (count - 1) * DetectionFraming.WindowHop - DetectionFraming.LeadInSamples;
        var realSamples = audio.Length - lastStart;
        var offset = (count - 1) * DetectionFraming.WindowSamples;

        Assert.InRange(realSamples, 1, DetectionFraming.WindowSamples - 1);

        for (var i = realSamples; i < DetectionFraming.WindowSamples; i++)
        {
            Assert.Equal(0f, framed[offset + i]);
        }
    }

    [Fact]
    public void Framing_produces_one_window_worth_of_samples_per_window()
    {
        var (framed, count) = DetectionFraming.FrameForModel(Ramp(100000));

        Assert.Equal(count * DetectionFraming.WindowSamples, framed.Length);
    }

    /// <summary>
    /// Audio whose value at every index says which index it is, over a span far
    /// longer than a window, so a window copied from the wrong offset cannot
    /// match by coincidence.
    /// </summary>
    private static float[] Ramp(int sampleCount)
    {
        var audio = new float[sampleCount];
        for (var i = 0; i < sampleCount; i++)
        {
            audio[i] = (i % 65536) / 65536f - 0.5f;
        }

        return audio;
    }
}
